import type { NormalizedFrame } from './types'

/**
 * Détection des coachs.
 *
 * Un coach connecté occupe une place dans `allplayers` exactement comme un
 * joueur, mais il ne joue jamais : il reste mort du début à la fin de chaque
 * manche. Affiché tel quel, il produit un sixième portrait éteint dans une
 * colonne prévue pour cinq — le défaut le plus visible d'un HUD sur un match
 * avec coach.
 *
 * Le roster serveur porte déjà un drapeau `isCoach` ; cette détection ne le
 * remplace pas, elle couvre le cas courant du match joué sans configuration
 * préalable, où personne n'a rempli quoi que ce soit.
 */

/**
 * Manches consécutives sans une seule frame en vie avant de conclure.
 *
 * À une manche, un joueur déconnecté au mauvais moment ou mort dès le pistolet
 * de départ serait masqué à tort — et masquer un vrai joueur est bien pire que
 * d'afficher un coach une manche de trop. Deux manches lèvent le doute.
 */
const ROUNDS_BEFORE_VERDICT = 2

/**
 * Effectif à partir duquel on cherche un coach.
 *
 * En dessous de six, une équipe n'a personne en trop : un joueur constamment
 * mort est un joueur qui joue mal, pas un coach.
 */
const CROWDED_TEAM = 6

/** Verdict par défaut, partagé : aucun coach tant qu'on n'a rien observé. */
const NO_COACH: ReadonlySet<string> = new Set()

interface Watch {
  side: 'CT' | 'T'
  /** Vrai si le joueur a été vu en vie durant la manche courante. */
  aliveThisRound: boolean
  /** Manches complètes terminées sans jamais être en vie. */
  deadRounds: number
}

export class CoachDetector {
  private watched = new Map<string, Watch>()
  private round = -1
  private coaches: ReadonlySet<string> = NO_COACH

  reset(): void {
    this.watched.clear()
    this.round = -1
    this.coaches = NO_COACH
  }

  /** SteamIDs identifiés comme coachs. */
  get current(): ReadonlySet<string> {
    return this.coaches
  }

  ingest(frame: NormalizedFrame): ReadonlySet<string> {
    const round = frame.map?.round ?? -1

    if (round !== this.round) {
      // Changement de manche : on solde la précédente. Un joueur jamais vu
      // vivant sur toute sa durée gagne une manche « morte » ; le moindre
      // instant en vie remet le compteur à zéro.
      if (this.round !== -1) {
        for (const watch of this.watched.values()) {
          watch.deadRounds = watch.aliveThisRound ? 0 : watch.deadRounds + 1
          watch.aliveThisRound = false
        }
      }
      this.round = round
    }

    const present = new Set<string>()
    for (const player of frame.players) {
      present.add(player.steamId)
      const watch = this.watched.get(player.steamId)
      if (watch) {
        watch.side = player.side
        if (player.alive) watch.aliveThisRound = true
      } else {
        this.watched.set(player.steamId, {
          side: player.side,
          aliveThisRound: player.alive,
          deadRounds: 0
        })
      }
    }

    // Un joueur parti ne doit pas continuer à peser sur l'effectif de son camp.
    for (const steamId of this.watched.keys()) {
      if (!present.has(steamId)) this.watched.delete(steamId)
    }

    const headcount = { CT: 0, T: 0 }
    for (const player of frame.players) headcount[player.side] += 1

    const coaches = new Set<string>()
    for (const [steamId, watch] of this.watched) {
      if (headcount[watch.side] < CROWDED_TEAM) continue
      if (watch.deadRounds >= ROUNDS_BEFORE_VERDICT) coaches.add(steamId)
    }

    this.coaches = coaches
    return coaches
  }
}
