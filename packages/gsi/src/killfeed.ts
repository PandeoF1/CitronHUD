import type { KillEvent, Side, Slot } from '@citronhud/contracts'
import type { NormalizedFrame, NormalizedPlayer } from './types'
import { weaponLabel } from './weapons'

/**
 * Reconstruction du killfeed.
 *
 * CS2 ne diffuse AUCUN killfeed par Game State Integration — c'est la principale
 * limite du flux, et la raison pour laquelle la plupart des HUDs gratuits n'en
 * proposent pas. On le reconstitue en comparant deux trames consécutives : un
 * compteur de morts qui monte identifie la victime, un compteur de kills qui
 * monte identifie le tueur.
 *
 * Ce que la méthode donne honnêtement : tueur, victime, assistance, arme,
 * headshot, teamkill, suicide.
 * Ce qu'elle ne peut pas donner : wallbang, noscope, à travers la fumée. Ces
 * informations n'existent nulle part dans le flux, et les inventer produirait
 * un killfeed qui ment à l'antenne.
 */

export interface KillfeedOptions {
  /** Nombre d'évènements conservés dans l'historique interne. */
  historySize?: number
}

interface PlayerDelta {
  player: NormalizedPlayer
  previous: NormalizedPlayer
  killDelta: number
  deathDelta: number
  assistDelta: number
  headshotDelta: number
}

/** Carré de la distance entre deux positions ; la racine serait du calcul perdu. */
function distanceSquared(a: NormalizedPlayer, b: NormalizedPlayer): number {
  if (!a.position || !b.position) return Number.POSITIVE_INFINITY
  const dx = a.position[0] - b.position[0]
  const dy = a.position[1] - b.position[1]
  const dz = a.position[2] - b.position[2]
  return dx * dx + dy * dy + dz * dz
}

export class KillFeedEngine {
  private previous: NormalizedFrame | null = null
  private lastRound = -1
  private lastMap: string | null = null
  private sequence = 0
  private readonly history: KillEvent[] = []
  private readonly historySize: number

  constructor(options: KillfeedOptions = {}) {
    this.historySize = options.historySize ?? 12
  }

  /** Les évènements récents, du plus ancien au plus récent. */
  get recent(): readonly KillEvent[] {
    return this.history
  }

  reset(): void {
    this.previous = null
    this.lastRound = -1
    this.lastMap = null
    this.history.length = 0
  }

  /** Vide l'historique affiché sans perdre la trame de référence. */
  clearHistory(): void {
    this.history.length = 0
  }

  /**
   * Consomme une trame et renvoie les kills survenus depuis la précédente.
   *
   * @param slotOf Résout le camp en position d'écran, pour que l'overlay sache
   *               de quel côté afficher chaque protagoniste.
   */
  ingest(frame: NormalizedFrame, slotOf: (side: Side) => Slot): KillEvent[] {
    const previous = this.previous
    const mapName = frame.map?.name ?? null
    const round = frame.map?.round ?? 0

    /*
     * Changement de carte ou retour en arrière du compteur de manches : les
     * statistiques cumulées repartent de zéro et tous les deltas deviennent
     * absurdes. On repart d'une référence propre sans rien émettre.
     */
    if (mapName !== this.lastMap || round < this.lastRound) {
      this.previous = frame
      this.lastMap = mapName
      this.lastRound = round
      this.history.length = 0
      return []
    }

    const roundChanged = round !== this.lastRound
    this.lastMap = mapName
    this.lastRound = round
    this.previous = frame

    if (!previous) return []

    /*
     * Hors manche jouée, aucun kill ne compte. L'échauffement en particulier
     * génère des morts en rafale qui pollueraient le feed et fausseraient les
     * temps forts.
     */
    if (frame.phase !== 'live' && frame.phase !== 'over') return []

    // Le début de manche remet les compteurs de manche à zéro : deltas ignorés.
    if (roundChanged) return []

    const deltas = this.computeDeltas(previous, frame)
    if (deltas.length === 0) return []

    const events = this.pairKills(deltas, frame, round, slotOf)

    for (const event of events) {
      this.history.push(event)
      if (this.history.length > this.historySize) this.history.shift()
    }

    return events
  }

  private computeDeltas(previous: NormalizedFrame, frame: NormalizedFrame): PlayerDelta[] {
    const deltas: PlayerDelta[] = []

    for (const player of frame.players) {
      const before = previous.playersBySteamId.get(player.steamId)
      if (!before) continue

      const killDelta = player.kills - before.kills
      const deathDelta = player.deaths - before.deaths
      const assistDelta = player.assists - before.assists
      const headshotDelta = player.roundHeadshots - before.roundHeadshots

      if (killDelta === 0 && deathDelta === 0 && assistDelta === 0) continue

      deltas.push({
        player,
        previous: before,
        killDelta,
        deathDelta,
        assistDelta,
        headshotDelta: Math.max(0, headshotDelta)
      })
    }

    return deltas
  }

  private pairKills(
    deltas: PlayerDelta[],
    frame: NormalizedFrame,
    round: number,
    slotOf: (side: Side) => Slot
  ): KillEvent[] {
    const victims = deltas.filter((d) => d.deathDelta > 0)
    if (victims.length === 0) return []

    /*
     * Capacité restante de chaque tueur potentiel. Une fenêtre de 100 ms peut
     * contenir deux kills du même joueur : le delta vaut alors 2 et le tueur
     * doit pouvoir être apparié deux fois.
     */
    const capacity = new Map<string, number>()
    for (const delta of deltas) {
      if (delta.killDelta > 0) capacity.set(delta.player.steamId, delta.killDelta)
    }

    /** Headshots restant à attribuer, par tueur. */
    const headshotBudget = new Map<string, number>()
    for (const delta of deltas) {
      if (delta.killDelta > 0) headshotBudget.set(delta.player.steamId, delta.headshotDelta)
    }

    const assisters = deltas.filter((d) => d.assistDelta > 0)
    const events: KillEvent[] = []

    for (const victimDelta of victims) {
      const victim = victimDelta.player
      const killer = this.pickKiller(victimDelta, deltas, capacity)

      let headshot = false
      if (killer) {
        capacity.set(killer.player.steamId, (capacity.get(killer.player.steamId) ?? 1) - 1)
        const budget = headshotBudget.get(killer.player.steamId) ?? 0
        if (budget > 0) {
          headshot = true
          headshotBudget.set(killer.player.steamId, budget - 1)
        }
      }

      /*
       * L'arme est relevée sur la trame PRÉCÉDENTE : le kill s'est produit entre
       * les deux, et un joueur qui enchaîne bascule souvent déjà sur autre chose
       * dans la trame courante.
       */
      const weaponName =
        killer?.previous.activeWeapon?.name ?? killer?.player.activeWeapon?.name ?? null

      const assister = assisters.find(
        (candidate) =>
          candidate.player.steamId !== victim.steamId &&
          candidate.player.steamId !== killer?.player.steamId &&
          candidate.player.side !== victim.side
      )

      const isTeamkill = !!killer && killer.player.side === victim.side
      const isSuicide = !killer

      this.sequence += 1
      events.push({
        id: `${round}-${victim.steamId}-${frame.receivedAt}-${this.sequence}`,
        at: frame.receivedAt,
        round,
        killer: killer
          ? {
              steamId: killer.player.steamId,
              name: killer.player.name,
              side: killer.player.side,
              slot: slotOf(killer.player.side)
            }
          : null,
        victim: {
          steamId: victim.steamId,
          name: victim.name,
          side: victim.side,
          slot: slotOf(victim.side)
        },
        assister: assister
          ? {
              steamId: assister.player.steamId,
              name: assister.player.name,
              side: assister.player.side
            }
          : null,
        weapon: weaponName,
        weaponLabel: weaponName ? weaponLabel(weaponName) : null,
        headshot,
        teamkill: isTeamkill,
        suicide: isSuicide
      })
    }

    return events
  }

  /**
   * Attribue un tueur à une victime.
   *
   * Ordre de préférence :
   *  1. un adversaire dont le compteur de kills a monté et qui a encore de la
   *     capacité — le cas normal ;
   *  2. en cas d'égalité, le plus proche géométriquement, ce qui départage les
   *     doubles kills simultanés bien mieux que l'ordre d'itération ;
   *  3. un coéquipier dont le compteur a BAISSÉ — CS2 retire un kill sur un
   *     teamkill, ce qui en fait une signature fiable ;
   *  4. personne : chute, bombe, ou déconnexion.
   */
  private pickKiller(
    victimDelta: PlayerDelta,
    deltas: PlayerDelta[],
    capacity: Map<string, number>
  ): PlayerDelta | null {
    const victim = victimDelta.player

    const enemies = deltas.filter(
      (candidate) =>
        candidate.player.steamId !== victim.steamId &&
        candidate.player.side !== victim.side &&
        (capacity.get(candidate.player.steamId) ?? 0) > 0
    )

    if (enemies.length === 1) return enemies[0]!
    if (enemies.length > 1) {
      return enemies.reduce((closest, candidate) =>
        distanceSquared(candidate.previous, victimDelta.previous) <
        distanceSquared(closest.previous, victimDelta.previous)
          ? candidate
          : closest
      )
    }

    const teamkiller = deltas.find(
      (candidate) =>
        candidate.player.steamId !== victim.steamId &&
        candidate.player.side === victim.side &&
        candidate.killDelta < 0
    )
    if (teamkiller) return teamkiller

    return null
  }
}
