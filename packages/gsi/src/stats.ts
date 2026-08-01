import type { NormalizedFrame } from './types'

/**
 * Statistiques cumulées sur la carte.
 *
 * Le GSI ne fournit ni ADR ni pourcentage de headshots : il donne des compteurs
 * PAR MANCHE (`round_totaldmg`, `round_killhs`) qui repartent à zéro à chaque
 * manche. Il faut donc les capturer avant leur remise à zéro et les cumuler
 * soi-même. Tous les HUDs qui affichent l'ADR font exactement cela.
 */

interface PlayerAccumulator {
  damage: number
  headshotKills: number
}

export interface DerivedStats {
  /** Dégâts moyens par manche, manche en cours comprise. */
  adr: number
  /** Dégâts cumulés sur la carte. */
  totalDamage: number
  headshotKills: number
  headshotPercent: number
  kd: number
}

export class MatchStatsTracker {
  /** Cumul des manches TERMINÉES. */
  private readonly accumulated = new Map<string, PlayerAccumulator>()
  /** Valeurs de la manche en cours, écrasées à chaque trame. */
  private readonly current = new Map<string, PlayerAccumulator>()
  private currentRound = -1
  private currentMap: string | null = null

  reset(): void {
    this.accumulated.clear()
    this.current.clear()
    this.currentRound = -1
    this.currentMap = null
  }

  /** Nombre de manches prises en compte, manche en cours incluse. */
  get roundsCounted(): number {
    if (this.currentRound < 0) return 0
    return this.currentRound + 1
  }

  ingest(frame: NormalizedFrame): void {
    const map = frame.map
    if (!map) return

    // Nouvelle carte : le cumul de la précédente n'a plus de sens.
    if (map.name !== this.currentMap) {
      this.reset()
      this.currentMap = map.name
    }

    /*
     * `map.round` compte les manches TERMINÉES : il s'incrémente à l'ouverture
     * de la manche suivante, juste avant que les compteurs par manche ne soient
     * remis à zéro. C'est donc le bon moment pour verser la manche écoulée au
     * cumul — un instant plus tard, les valeurs seraient perdues.
     */
    if (map.round !== this.currentRound) {
      if (this.currentRound >= 0) this.commitCurrentRound()
      this.currentRound = map.round
      this.current.clear()
    }

    for (const player of frame.players) {
      const entry = this.current.get(player.steamId) ?? { damage: 0, headshotKills: 0 }
      /*
       * `max` plutôt qu'affectation : à la toute fin d'une manche, une trame
       * peut arriver après la remise à zéro mais avant l'incrément du compteur
       * de manches. Prendre le maximum protège le cumul de cette inversion.
       */
      entry.damage = Math.max(entry.damage, player.roundDamage)
      entry.headshotKills = Math.max(entry.headshotKills, player.roundHeadshots)
      this.current.set(player.steamId, entry)
    }
  }

  /**
   * Verse la dernière manche au cumul.
   *
   * À appeler en fin de carte : sans cela, la manche décisive n'entrerait
   * jamais dans l'ADR final, puisque `map.round` ne s'incrémente plus après.
   */
  finalize(): void {
    this.commitCurrentRound()
    this.current.clear()
  }

  private commitCurrentRound(): void {
    for (const [steamId, round] of this.current) {
      const total = this.accumulated.get(steamId) ?? { damage: 0, headshotKills: 0 }
      total.damage += round.damage
      total.headshotKills += round.headshotKills
      this.accumulated.set(steamId, total)
    }
  }

  /** Statistiques dérivées d'un joueur, manche en cours comprise. */
  derive(steamId: string, kills: number, deaths: number): DerivedStats {
    const total = this.accumulated.get(steamId) ?? { damage: 0, headshotKills: 0 }
    const round = this.current.get(steamId) ?? { damage: 0, headshotKills: 0 }

    const totalDamage = total.damage + round.damage
    const headshotKills = total.headshotKills + round.headshotKills
    const rounds = Math.max(1, this.roundsCounted)

    return {
      adr: totalDamage / rounds,
      totalDamage,
      headshotKills,
      headshotPercent: kills > 0 ? (headshotKills / kills) * 100 : 0,
      // Un joueur sans mort divise par 1 : afficher l'infini n'aiderait personne.
      kd: deaths > 0 ? kills / deaths : kills
    }
  }
}
