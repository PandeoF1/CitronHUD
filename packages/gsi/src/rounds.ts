import type { Player, RoundEndReason, RoundReview, Side, Slot } from '@citronhud/contracts'
import type { MatchStatsTracker } from './stats'
import type { NormalizedFrame, NormalizedPlayer } from './types'

/**
 * Bilan de fin de manche.
 *
 * La difficulté n'est pas le calcul mais l'instant : les compteurs par manche du
 * GSI (`round_kills`, `round_totaldmg`) sont remis à zéro dès le temps de gel
 * suivant. Un bilan construit à l'affichage arriverait systématiquement vide. On
 * fige donc tout au passage en phase « over », et l'overlay se contente de lire.
 */

/**
 * Traduction des libellés de `round_wins`.
 *
 * Valve préfixe par le camp (`ct_win_elimination`) ; le camp étant déjà connu
 * par ailleurs, seule la cause nous intéresse ici.
 */
const REASONS: Record<string, RoundEndReason> = {
  elimination: 'elimination',
  bomb: 'bomb',
  defuse: 'defuse',
  time: 'time',
  rescue: 'rescue',
  hostage: 'rescue'
}

function parseReason(raw: string | undefined): RoundEndReason {
  if (!raw) return 'unknown'
  for (const [needle, reason] of Object.entries(REASONS)) {
    if (raw.includes(needle)) return reason
  }
  return 'unknown'
}

export interface ReviewContext {
  slotOf: (side: Side) => Slot
  rosterOf: (steamId: string) => Player | undefined
  stats: MatchStatsTracker
  /** SteamIDs à écarter du bilan — coachs détectés ou déclarés. */
  hidden: ReadonlySet<string>
}

export class RoundReviewTracker {
  private review: RoundReview | null = null
  private lastPhase: string | null = null
  /** Compteur de MVP de chaque joueur à la trame précédente. */
  private mvpCounts = new Map<string, number>()

  reset(): void {
    this.review = null
    this.lastPhase = null
    this.mvpCounts.clear()
  }

  get current(): RoundReview | null {
    return this.review
  }

  ingest(frame: NormalizedFrame, context: ReviewContext): RoundReview | null {
    const phase = frame.phase

    if (phase === 'over' && this.lastPhase !== 'over') {
      this.review = this.build(frame, context)
    } else if (phase === 'over' && this.review) {
      // Le jeu décerne son MVP quelques trames après la fin de la manche : on
      // laisse le bilan se corriger tant qu'il est encore à l'écran.
      this.applyGameMvp(frame, context)
    } else if (phase === 'live' || phase === 'gameover') {
      // La manche suivante a commencé : le bilan n'a plus lieu d'être.
      this.review = null
    }

    if (phase !== 'over') {
      this.mvpCounts = new Map(frame.players.map((player) => [player.steamId, player.mvps]))
    }

    this.lastPhase = phase
    return this.review
  }

  private build(frame: NormalizedFrame, context: ReviewContext): RoundReview | null {
    const winnerSide = frame.round?.winTeam
    if (!winnerSide || !frame.map) return null

    const round = frame.map.round
    // `round_wins` est indexé à partir de 1, alors que `map.round` compte les
    // manches déjà terminées : la manche qui vient de finir est donc la suivante.
    const reason = parseReason(frame.map.roundWins[String(round + 1)])

    const leftSlot = context.slotOf('CT') === 'left' ? 'CT' : 'T'
    const score = {
      left: leftSlot === 'CT' ? frame.map.ctScore : frame.map.tScore,
      right: leftSlot === 'CT' ? frame.map.tScore : frame.map.ctScore
    }

    const players = frame.players
      .filter((player) => !context.hidden.has(player.steamId))
      .map((player) => this.describe(player, context))

    const review: RoundReview = {
      round: round + 1,
      winnerSide,
      winnerSlot: context.slotOf(winnerSide),
      reason,
      score,
      mvp: null,
      players
    }

    review.mvp = this.pickMvp(review, winnerSide)
    return review
  }

  private describe(player: NormalizedPlayer, context: ReviewContext): RoundReview['players'][number] {
    const known = context.rosterOf(player.steamId)
    const derived = context.stats.derive(player.steamId, player.kills, player.deaths)

    return {
      steamId: player.steamId,
      name: known?.nickname ?? player.name,
      avatarUrl: known?.avatarUrl ?? null,
      side: player.side,
      slot: context.slotOf(player.side),
      survived: player.alive,
      kills: player.roundKills,
      headshots: player.roundHeadshots,
      damage: player.roundDamage,
      totalKills: player.kills,
      totalAssists: player.assists,
      totalDeaths: player.deaths,
      adr: derived.adr,
      headshotPercent: derived.headshotPercent
    }
  }

  /**
   * Choisit le joueur de la manche.
   *
   * Le camp vainqueur d'abord : une performance individuelle dans une manche
   * perdue n'est pas ce que le spectateur attend sous le mot « MVP ». Ensuite
   * les frags, puis les dégâts pour départager — un joueur qui a ouvert trois
   * duels passe devant un joueur qui a récupéré deux kills gratuits.
   */
  private pickMvp(review: RoundReview, winnerSide: Side): RoundReview['mvp'] {
    const candidates = review.players.filter((player) => player.side === winnerSide)
    if (candidates.length === 0) return null

    const best = candidates.reduce((leader, player) =>
      player.kills !== leader.kills
        ? player.kills > leader.kills
          ? player
          : leader
        : player.damage > leader.damage
          ? player
          : leader
    )

    // Une manche gagnée sans qu'aucun vainqueur ne touche personne (temps
    // écoulé, désamorçage tranquille) n'a pas de joueur à mettre en avant.
    if (best.kills === 0 && best.damage === 0) return null

    return {
      steamId: best.steamId,
      name: best.name,
      avatarUrl: best.avatarUrl,
      side: best.side,
      slot: best.slot,
      kills: best.kills,
      headshots: best.headshots,
      damage: best.damage,
      reason: mvpReason(best.kills, best.headshots, best.damage, review.reason)
    }
  }

  /**
   * Remplace notre choix par celui du jeu quand il arrive.
   *
   * CS2 décerne son MVP à l'entité qui a réellement décidé la manche — le poseur
   * de bombe, le désamorceur — ce qu'aucun comptage de frags ne retrouve.
   */
  private applyGameMvp(frame: NormalizedFrame, context: ReviewContext): void {
    if (!this.review) return

    for (const player of frame.players) {
      const before = this.mvpCounts.get(player.steamId)
      if (before === undefined || player.mvps <= before) continue
      if (context.hidden.has(player.steamId)) continue

      const known = context.rosterOf(player.steamId)
      this.review = {
        ...this.review,
        mvp: {
          steamId: player.steamId,
          name: known?.nickname ?? player.name,
          avatarUrl: known?.avatarUrl ?? null,
          side: player.side,
          slot: context.slotOf(player.side),
          kills: player.roundKills,
          headshots: player.roundHeadshots,
          damage: player.roundDamage,
          reason: mvpReason(
            player.roundKills,
            player.roundHeadshots,
            player.roundDamage,
            this.review.reason
          )
        }
      }
      this.mvpCounts.set(player.steamId, player.mvps)
      return
    }
  }
}

/** Formule courte affichée sous le nom du MVP. */
function mvpReason(
  kills: number,
  headshots: number,
  damage: number,
  roundReason: RoundEndReason
): string {
  if (kills >= 3) return `${kills} frags`
  if (kills > 0 && headshots === kills) return kills === 1 ? '1 frag, headshot' : `${kills} headshots`
  if (kills > 0) return kills === 1 ? '1 frag' : `${kills} frags`
  if (roundReason === 'defuse') return 'Désamorçage'
  if (roundReason === 'bomb') return 'Pose décisive'
  return `${Math.round(damage)} dégâts`
}
