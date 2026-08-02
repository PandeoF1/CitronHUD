import type {
  Bomb,
  HudConfig,
  HudGrenade,
  HudPlayer,
  HudState,
  KillEvent,
  MatchSetup,
  Player,
  RecordBroken,
  ResolvedTeam,
  Side,
  SideAssignment,
  Slot,
  Team,
  TeamSlot
} from '@citronhud/contracts'
import { normalizeFrame } from './frame'
import { KillFeedEngine } from './killfeed'
import { CoachDetector } from './coaches'
import { GrenadeTracker } from './grenades'
import { RoundReviewTracker } from './rounds'
import { SideDetector } from './sides'
import { HighlightDetector, type HighlightSeed } from './highlights'
import { MatchStatsTracker } from './stats'
import { RecordTracker, type KnownRecord } from './records'
import { mapLabel } from './maps'
import { grenadeSortIndex, isCarriedItem, isGrenade, weaponLabel } from './weapons'
import type { NormalizedFrame, NormalizedPlayer, RawGsiPayload } from './types'

/**
 * Le moteur — orchestre tous les sous-systèmes et produit l'état HUD.
 *
 * Une trame brute entre, un état entièrement résolu sort. Toute la logique
 * métier vit ici, du côté Node : elle est testable sans navigateur, et
 * l'overlay se réduit à une fonction de rendu. Un HUD qui décide de choses est
 * un HUD qu'on ne peut déboguer qu'en direct.
 */

export interface EngineRoster {
  /** Joueurs indexés par SteamID. */
  players: ReadonlyMap<string, Player>
  /** Équipes indexées par identifiant. */
  teams: ReadonlyMap<string, Team>
}

export interface EngineTick {
  state: HudState
  /** Kills survenus depuis la trame précédente. */
  kills: KillEvent[]
  /** Temps forts détectés sur cette trame. */
  highlights: HighlightSeed[]
  /** Records tombés sur cette trame. */
  records: RecordBroken[]
}

const EMPTY_ROSTER: EngineRoster = { players: new Map(), teams: new Map() }

/** Durée de désamorçage, avec et sans kit. */
const DEFUSE_SECONDS = { withKit: 5, withoutKit: 10 } as const

export class CitronEngine {
  private readonly killfeed = new KillFeedEngine()
  private readonly highlights = new HighlightDetector()
  private readonly stats = new MatchStatsTracker()
  private readonly records = new RecordTracker()
  private readonly coaches = new CoachDetector()
  private readonly grenades = new GrenadeTracker()
  private readonly reviews = new RoundReviewTracker()
  private readonly detector: SideDetector

  private roster: EngineRoster = EMPTY_ROSTER
  private match: MatchSetup | null = null
  private config: HudConfig
  private lastFrame: NormalizedFrame | null = null
  /**
   * Utilitaires de la dernière trame ingérée.
   *
   * Mémorisés plutôt que recalculés dans `buildState` : celui-ci est aussi
   * appelé par `markStale`, et faire avancer le suivi des traînées depuis un
   * chemin qui ne consomme aucune trame allongerait les traces à l'infini.
   */
  private liveGrenades: HudGrenade[] = []

  /** Verrouillé au début du désamorçage : après coup l'information disparaît. */
  private defuseTooLate = false
  private lastBombState: string | null = null

  constructor(config: HudConfig, initialSides?: Partial<SideAssignment>) {
    this.config = config
    this.detector = new SideDetector(initialSides)
  }

  setRoster(roster: EngineRoster): void {
    this.roster = roster
  }

  setMatch(match: MatchSetup | null): void {
    const changed = match?.id !== this.match?.id
    this.match = match
    if (changed) {
      this.killfeed.reset()
      this.highlights.reset()
      this.stats.reset()
      this.records.reset()
      this.coaches.reset()
      this.grenades.reset()
      this.reviews.reset()
    }
  }

  setConfig(config: HudConfig): void {
    this.config = config
  }

  loadRecords(records: readonly KnownRecord[]): void {
    this.records.load(records)
  }

  get sides(): SideAssignment {
    return this.detector.current
  }

  get sessionRecordBests() {
    return this.records.sessionBests
  }

  /** Inverse les camps à la main — le bouton du panneau de contrôle. */
  swapSides(): SideAssignment {
    return this.detector.swap()
  }

  setSideMode(mode: 'auto' | 'manual', leftSide?: Side): SideAssignment {
    if (mode === 'auto') return this.detector.setAuto()
    return this.detector.setManual(leftSide ?? this.detector.current.leftSide)
  }

  /** Le HUD n'a plus reçu de trame : bascule en état « hors ligne ». */
  markStale(): HudState | null {
    if (!this.lastFrame) return null
    return { ...this.buildState(this.lastFrame), live: false }
  }

  ingest(payload: RawGsiPayload, receivedAt = Date.now()): EngineTick {
    const frame = normalizeFrame(payload, receivedAt)
    this.lastFrame = frame

    // Détection des camps d'abord : tout le reste s'oriente par rapport à elle.
    this.detector.update(frame, {
      playerTeam: this.playerTeamIndex(),
      leftTeamId: this.teamIdOf(this.match?.left),
      rightTeamId: this.teamIdOf(this.match?.right)
    })

    this.stats.ingest(frame)
    if (frame.phase === 'gameover') this.stats.finalize()

    this.coaches.ingest(frame)
    this.liveGrenades = this.grenades.ingest(
      frame,
      (steamId) => frame.playersBySteamId.get(steamId)?.side ?? null
    )
    this.reviews.ingest(frame, {
      slotOf: this.detector.slotOf,
      rosterOf: (steamId) => this.roster.players.get(steamId),
      stats: this.stats,
      hidden: this.hiddenSteamIds(frame)
    })

    const kills = this.killfeed.ingest(frame, this.detector.slotOf)
    const highlights = this.highlights.ingest(frame, kills, { slotOf: this.detector.slotOf })
    const records = this.config.showRecordToasts
      ? this.records.ingest(frame, this.stats, (steamId) => {
          const player = this.roster.players.get(steamId)
          return {
            name: player?.nickname ?? frame.playersBySteamId.get(steamId)?.name ?? 'Inconnu',
            avatarUrl: player?.avatarUrl ?? null
          }
        })
      : []

    this.trackDefuse(frame)

    return { state: this.buildState(frame), kills, highlights, records }
  }

  /* ---------------------------------------------------------------------
   * Construction de l'état
   * ------------------------------------------------------------------ */

  /**
   * SteamIDs à ne pas montrer.
   *
   * Deux sources : le drapeau `isCoach` du roster serveur, qui fait autorité
   * quand il est renseigné, et la détection automatique pour les matchs joués
   * sans configuration préalable — le cas nominal côté streamer.
   */
  private hiddenSteamIds(frame: NormalizedFrame): ReadonlySet<string> {
    const hidden = new Set(this.coaches.current)
    for (const player of frame.players) {
      if (this.roster.players.get(player.steamId)?.isCoach) hidden.add(player.steamId)
    }
    return hidden
  }

  private playerTeamIndex(): ReadonlyMap<string, string> {
    const index = new Map<string, string>()
    for (const [steamId, player] of this.roster.players) {
      if (player.teamId) index.set(steamId, player.teamId)
    }
    return index
  }

  private teamIdOf(slot: TeamSlot | undefined): string | null {
    return slot?.source === 'roster' ? slot.teamId : null
  }

  /**
   * Verrouille l'issue d'un désamorçage dès son démarrage.
   *
   * C'est l'information la plus tendue du jeu : le désamorçage prend 5 ou 10
   * secondes selon le kit, et une fois lancé on sait immédiatement s'il peut
   * aboutir. Aucun HUD gratuit ne l'affiche, alors que c'est exactement ce que
   * le commentateur cherche à dire.
   */
  private trackDefuse(frame: NormalizedFrame): void {
    const bomb = frame.bomb
    if (!bomb) {
      this.defuseTooLate = false
      this.lastBombState = null
      return
    }

    if (bomb.state === 'defusing' && this.lastBombState !== 'defusing') {
      const defuser = bomb.playerSteamId ? frame.playersBySteamId.get(bomb.playerSteamId) : null
      const needed = defuser?.defuseKit ? DEFUSE_SECONDS.withKit : DEFUSE_SECONDS.withoutKit
      this.defuseTooLate = bomb.countdown !== null && bomb.countdown < needed
    }

    if (bomb.state !== 'defusing') this.defuseTooLate = false
    this.lastBombState = bomb.state
  }

  private buildState(frame: NormalizedFrame): HudState {
    const sides = this.detector.current
    const leftSide = sides.leftSide
    const rightSide: Side = leftSide === 'CT' ? 'T' : 'CT'

    const teams = {
      left: this.resolveTeam('left', leftSide, frame),
      right: this.resolveTeam('right', rightSide, frame)
    }

    const hidden = this.hiddenSteamIds(frame)
    const players = frame.players
      .filter((player) => !hidden.has(player.steamId))
      .map((player) => this.resolvePlayer(player, frame))

    const observed = players.find((player) => player.isObserved) ?? null

    return {
      live: true,
      updatedAt: frame.receivedAt,
      map: frame.map
        ? {
            name: frame.map.name,
            label: frame.map.label,
            mode: frame.map.mode,
            phase: frame.phase,
            round: frame.map.round,
            phaseEndsIn: frame.phaseEndsIn,
            roundWins: frame.map.roundWins,
            overtime: frame.map.ctScore + frame.map.tScore >= 24,
            regulationMR: 12,
            overtimeMR: 3
          }
        : null,
      phase: frame.phase,
      bomb: this.resolveBomb(frame),
      teams,
      players,
      observed,
      killfeed: [...this.killfeed.recent],
      grenades: this.config.showGrenades ? this.liveGrenades : [],
      roundReview: this.config.showRoundReview ? this.reviews.current : null,
      event: this.match?.event ?? { name: '', stage: '' },
      series: this.resolveSeries(),
      sides: {
        mode: sides.mode,
        leftSide: sides.leftSide,
        confidence: sides.confidence,
        matchedPlayers: sides.matchedPlayers
      }
    }
  }

  private resolveBomb(frame: NormalizedFrame): Bomb | null {
    const bomb = frame.bomb
    if (!bomb) return null

    const state = (
      ['carried', 'dropped', 'planting', 'planted', 'defusing', 'defused', 'exploded'] as const
    ).includes(bomb.state as never)
      ? (bomb.state as Bomb['state'])
      : 'carried'

    let site: 'A' | 'B' | null = null
    if (bomb.position && frame.map) {
      // Le GSI ne nomme pas le site ; on laisse le HUD s'en passer plutôt que
      // de deviner avec des zones codées en dur, fausses à chaque mise à jour.
      site = null
    }

    return {
      state,
      countdown: bomb.countdown,
      site,
      playerSteamId: bomb.playerSteamId,
      position: bomb.position,
      defuseTooLate: this.defuseTooLate
    }
  }

  private resolveTeam(slot: Slot, side: Side, frame: NormalizedFrame): ResolvedTeam {
    const config = slot === 'left' ? this.match?.left : this.match?.right
    const score = side === 'CT' ? (frame.map?.ctScore ?? 0) : (frame.map?.tScore ?? 0)
    const lossBonus = side === 'CT' ? (frame.map?.ctLossBonus ?? 0) : (frame.map?.tLossBonus ?? 0)
    const timeouts = side === 'CT' ? (frame.map?.ctTimeouts ?? 0) : (frame.map?.tTimeouts ?? 0)
    const seriesWins =
      slot === 'left' ? (this.match?.seriesScore.left ?? 0) : (this.match?.seriesScore.right ?? 0)

    const opponentScore = side === 'CT' ? (frame.map?.tScore ?? 0) : (frame.map?.ctScore ?? 0)

    let name = slot === 'left' ? 'ÉQUIPE A' : 'ÉQUIPE B'
    let shortName = slot === 'left' ? 'A' : 'B'
    let logoUrl: string | null = null
    let color: string | null = null
    let country: string | null = null
    let teamId: string | null = null

    if (config?.source === 'roster') {
      const team = this.roster.teams.get(config.teamId)
      if (team) {
        name = team.name
        shortName = team.shortName
        logoUrl = team.logoUrl
        color = team.color
        country = team.country
        teamId = team.id
      }
    } else if (config?.source === 'adhoc') {
      name = config.name
      shortName = config.shortName
      logoUrl = config.logoUrl
      color = config.color
    }

    return {
      slot,
      side,
      name,
      shortName,
      logoUrl,
      color: this.config.useTeamColors ? color : null,
      country,
      teamId,
      score,
      seriesWins,
      lossBonus: Math.min(4, Math.max(0, lossBonus)),
      timeoutsRemaining: timeouts,
      matchPoint: this.isMatchPoint(score, opponentScore)
    }
  }

  /**
   * Balle de match.
   *
   * En MR12, la victoire tombe à 13 manches ; on est donc à balle de match à 12,
   * sauf si l'adversaire y est aussi — à 12-12 la carte part en prolongation et
   * personne n'a de balle de match.
   */
  private isMatchPoint(score: number, opponentScore: number): boolean {
    const roundsToWin = 13
    if (score !== roundsToWin - 1) return false
    return opponentScore < roundsToWin - 1
  }

  private resolveSeries(): HudState['series'] {
    const format = this.match?.format ?? 'bo1'
    const maps = (this.match?.vetos ?? [])
      .filter((veto) => veto.type !== 'ban')
      .map((veto) => ({
        mapName: veto.mapName,
        label: mapLabel(veto.mapName),
        played: veto.played,
        left: veto.score?.left ?? null,
        right: veto.score?.right ?? null,
        winner: veto.winner
      }))

    return { format, maps }
  }

  private resolvePlayer(player: NormalizedPlayer, frame: NormalizedFrame): HudPlayer {
    const known = this.roster.players.get(player.steamId)
    const derived = this.stats.derive(player.steamId, player.kills, player.deaths)

    const grenadeCounts = new Map<string, number>()
    for (const weapon of player.weapons) {
      if (!isGrenade(weapon.name)) continue
      grenadeCounts.set(weapon.name, (grenadeCounts.get(weapon.name) ?? 0) + 1)
    }

    const grenades = [...grenadeCounts.entries()]
      .sort(([a], [b]) => grenadeSortIndex(a) - grenadeSortIndex(b))
      .map(([name, count]) => ({ name, label: weaponLabel(name), count }))

    const realName = known
      ? [known.firstName, known.lastName].filter(Boolean).join(' ') || null
      : null

    return {
      steamId: player.steamId,
      name: known?.nickname ?? player.name,
      realName,
      country: known?.country ?? null,
      avatarUrl: known?.avatarUrl ?? null,
      role: known?.role ?? null,
      known: !!known,

      slot: this.detector.slotOf(player.side),
      side: player.side,
      observerSlot: player.observerSlot,

      alive: player.alive,
      health: player.health,
      armor: player.armor,
      helmet: player.helmet,
      defuseKit: player.defuseKit,
      flashed: player.flashed,
      burning: player.burning,
      money: player.money,
      equipmentValue: player.equipmentValue,

      weapons: player.weapons
        .filter((weapon) => !isCarriedItem(weapon.name))
        .map((weapon) => ({
          name: weapon.name,
          label: weapon.label,
          type: weapon.type,
          state: weapon.state,
          ammoClip: weapon.ammoClip,
          ammoClipMax: weapon.ammoClipMax,
          ammoReserve: weapon.ammoReserve
        })),
      grenades,

      stats: {
        kills: player.kills,
        assists: player.assists,
        deaths: player.deaths,
        mvps: player.mvps,
        score: player.score,
        adr: derived.adr,
        headshotKills: derived.headshotKills,
        headshotPercent: derived.headshotPercent,
        kd: derived.kd
      },
      roundKills: player.roundKills,
      roundHeadshots: player.roundHeadshots,
      roundDamage: player.roundDamage,

      position: player.position,
      forward: player.forward,

      isObserved: frame.observedSteamId === player.steamId
    }
  }
}
