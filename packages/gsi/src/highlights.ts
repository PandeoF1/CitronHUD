import type { HighlightKind, KillEvent, Side, Slot } from '@citronhud/contracts'
import { HIGHLIGHT_WEIGHT } from '@citronhud/contracts'
import type { NormalizedFrame, NormalizedPlayer } from './types'
import { aliveCounts } from './frame'
import { isKnife, isZeus } from './weapons'

/**
 * Détection des temps forts.
 *
 * Deux régimes selon la nature de l'évènement :
 *
 *  - IMMÉDIAT (kill au couteau, au Zeus) : l'action est close dès le kill, on
 *    déclenche tout de suite.
 *  - FIN DE MANCHE (multikills, clutch, désamorçage) : on attend la fin. Un ace
 *    passe forcément par 3 puis 4 kills ; déclencher au fil de l'eau produirait
 *    trois replays pour une seule action, et le spectateur verrait « TRIPLE
 *    KILL » sur une manche qui s'est terminée en ace.
 */

/** Temps fort détecté, avant enrichissement par le client. */
export interface HighlightSeed {
  kind: HighlightKind
  steamId: string
  playerName: string
  side: Side
  slot: Slot
  mapName: string
  round: number
  killCount: number
  clutchAgainst: number | null
  victims: Array<{ steamId: string; name: string }>
  weapons: string[]
  headshots: number
  occurredAt: string
  /** Poids éditorial, pour trancher quand plusieurs tombent ensemble. */
  weight: number
}

export interface HighlightContext {
  slotOf: (side: Side) => Slot
}

interface ClutchCandidate {
  steamId: string
  side: Side
  against: number
}

interface DefuseAttempt {
  steamId: string
  ctAlive: number
  tAlive: number
}

export class HighlightDetector {
  private round = -1
  private mapName: string | null = null
  private phase: string | null = null

  private clutch: ClutchCandidate | null = null
  private defuse: DefuseAttempt | null = null
  private lastBombCountdown: number | null = null
  private bombState: string | null = null

  /** Écart maximal subi par chaque camp pendant la manche. */
  private maxDeficit: Record<Side, number> = { CT: 0, T: 0 }

  /** Kills de la manche, pour reconstituer les victimes d'un multikill. */
  private roundKills: KillEvent[] = []

  /** Empêche le double déclenchement d'un même temps fort. */
  private fired = new Set<string>()

  /** Dernière trame en phase jouée, référence pour l'évaluation de fin de manche. */
  private lastLiveFrame: NormalizedFrame | null = null

  reset(): void {
    this.round = -1
    this.mapName = null
    this.phase = null
    this.resetRound()
    this.fired.clear()
  }

  private resetRound(): void {
    this.clutch = null
    this.defuse = null
    this.lastBombCountdown = null
    this.bombState = null
    this.maxDeficit = { CT: 0, T: 0 }
    this.roundKills = []
    this.lastLiveFrame = null
  }

  ingest(frame: NormalizedFrame, kills: KillEvent[], context: HighlightContext): HighlightSeed[] {
    const map = frame.map
    if (!map) return []

    if (map.name !== this.mapName) {
      this.mapName = map.name
      this.round = map.round
      this.resetRound()
      this.fired.clear()
      return []
    }

    if (map.round !== this.round) {
      this.round = map.round
      this.resetRound()
    }

    const seeds: HighlightSeed[] = []

    if (frame.phase === 'live') {
      this.lastLiveFrame = frame
      this.roundKills.push(...kills)
      this.trackClutch(frame)
      this.trackDeficit(frame)
      seeds.push(...this.detectImmediate(frame, kills, context))
    }

    this.trackBomb(frame)

    /*
     * Bascule live → over : la manche vient de se clore et tous les compteurs
     * par manche sont encore intacts. C'est la seule fenêtre où l'on peut lire
     * `roundKills` du vainqueur avant la remise à zéro.
     */
    if (this.phase === 'live' && frame.phase === 'over') {
      seeds.push(...this.detectRoundEnd(frame, context))
    }
    this.phase = frame.phase

    return seeds
  }

  /** Kills dont la nature suffit à faire un temps fort, sans attendre la suite. */
  private detectImmediate(
    frame: NormalizedFrame,
    kills: KillEvent[],
    context: HighlightContext
  ): HighlightSeed[] {
    const seeds: HighlightSeed[] = []

    for (const kill of kills) {
      if (!kill.killer || kill.teamkill || kill.suicide) continue

      let kind: HighlightKind | null = null
      if (isKnife(kill.weapon)) kind = 'knife_kill'
      else if (isZeus(kill.weapon)) kind = 'zeus_kill'
      if (!kind) continue

      const key = `${this.round}:${kill.killer.steamId}:${kind}:${kill.id}`
      if (this.fired.has(key)) continue
      this.fired.add(key)

      seeds.push({
        kind,
        steamId: kill.killer.steamId,
        playerName: kill.killer.name,
        side: kill.killer.side,
        slot: context.slotOf(kill.killer.side),
        mapName: frame.map?.name ?? '',
        round: this.round,
        killCount: 1,
        clutchAgainst: null,
        victims: [{ steamId: kill.victim.steamId, name: kill.victim.name }],
        weapons: kill.weapon ? [kill.weapon] : [],
        headshots: kill.headshot ? 1 : 0,
        occurredAt: new Date(kill.at).toISOString(),
        weight: HIGHLIGHT_WEIGHT[kind]
      })
    }

    return seeds
  }

  /**
   * Repère le dernier survivant d'un camp face à plusieurs adversaires.
   *
   * On ne retient que le PREMIER contexte de clutch de la manche : si le joueur
   * commence à 1 contre 4 et en tue deux, l'action reste « un 1v4 », pas un 1v2.
   * C'est le chiffre qui a du sens à l'antenne.
   */
  private trackClutch(frame: NormalizedFrame): void {
    if (this.clutch) return

    const alive = aliveCounts(frame)
    for (const side of ['CT', 'T'] as const) {
      const opponents = side === 'CT' ? alive.T : alive.CT
      if (alive[side] !== 1 || opponents < 2) continue

      const survivor = frame.players.find((p) => p.side === side && p.alive)
      if (!survivor) continue

      this.clutch = { steamId: survivor.steamId, side, against: opponents }
      return
    }
  }

  private trackDeficit(frame: NormalizedFrame): void {
    const alive = aliveCounts(frame)
    this.maxDeficit.CT = Math.max(this.maxDeficit.CT, alive.T - alive.CT)
    this.maxDeficit.T = Math.max(this.maxDeficit.T, alive.CT - alive.T)
  }

  /**
   * Suit la bombe pour qualifier les désamorçages.
   *
   * Le contexte doit être figé au DÉBUT du désamorçage : une fois la bombe
   * désamorcée, le compte à rebours disparaît du flux et les survivants ont pu
   * changer. Sans instantané, un ninja defuse serait indiscernable d'un
   * désamorçage tranquille à cinq joueurs.
   */
  private trackBomb(frame: NormalizedFrame): void {
    const bomb = frame.bomb
    if (!bomb) return

    if (bomb.countdown !== null) this.lastBombCountdown = bomb.countdown

    if (bomb.state === 'defusing' && this.bombState !== 'defusing' && bomb.playerSteamId) {
      const alive = aliveCounts(frame)
      this.defuse = { steamId: bomb.playerSteamId, ctAlive: alive.CT, tAlive: alive.T }
    }

    this.bombState = bomb.state
  }

  private detectRoundEnd(frame: NormalizedFrame, context: HighlightContext): HighlightSeed[] {
    const seeds: HighlightSeed[] = []
    const reference = this.lastLiveFrame ?? frame
    const mapName = frame.map?.name ?? ''
    const now = new Date().toISOString()
    const winner = frame.round?.winTeam ?? null

    // --- Multikills ---
    for (const player of reference.players) {
      const kills = player.roundKills
      if (kills < 3) continue

      const kind: HighlightKind = kills >= 5 ? 'ace' : kills === 4 ? 'quad_kill' : 'triple_kill'
      const key = `${this.round}:${player.steamId}:multikill`
      if (this.fired.has(key)) continue
      this.fired.add(key)

      const own = this.roundKills.filter((k) => k.killer?.steamId === player.steamId)
      seeds.push({
        kind,
        steamId: player.steamId,
        playerName: player.name,
        side: player.side,
        slot: context.slotOf(player.side),
        mapName,
        round: this.round,
        killCount: kills,
        clutchAgainst: null,
        victims: own.map((k) => ({ steamId: k.victim.steamId, name: k.victim.name })),
        weapons: [...new Set(own.map((k) => k.weapon).filter((w): w is string => !!w))],
        headshots: player.roundHeadshots,
        occurredAt: now,
        weight: HIGHLIGHT_WEIGHT[kind]
      })
    }

    // --- Clutch : il fallait gagner la manche ---
    if (this.clutch && winner === this.clutch.side) {
      const key = `${this.round}:${this.clutch.steamId}:clutch`
      if (!this.fired.has(key)) {
        this.fired.add(key)
        const player = reference.playersBySteamId.get(this.clutch.steamId)
        const own = this.roundKills.filter((k) => k.killer?.steamId === this.clutch!.steamId)
        seeds.push({
          kind: 'clutch',
          steamId: this.clutch.steamId,
          playerName: player?.name ?? 'Inconnu',
          side: this.clutch.side,
          slot: context.slotOf(this.clutch.side),
          mapName,
          round: this.round,
          killCount: own.length,
          clutchAgainst: this.clutch.against,
          victims: own.map((k) => ({ steamId: k.victim.steamId, name: k.victim.name })),
          weapons: [...new Set(own.map((k) => k.weapon).filter((w): w is string => !!w))],
          headshots: player?.roundHeadshots ?? 0,
          occurredAt: now,
          weight: HIGHLIGHT_WEIGHT.clutch
        })
      }
    }

    // --- Désamorçages remarquables ---
    if (this.defuse && this.bombState === 'defused') {
      const player = reference.playersBySteamId.get(this.defuse.steamId)
      const isNinja = this.defuse.ctAlive === 1 && this.defuse.tAlive >= 1
      const isLastSecond = this.lastBombCountdown !== null && this.lastBombCountdown < 1

      const kind: HighlightKind | null = isNinja
        ? 'ninja_defuse'
        : isLastSecond
          ? 'last_second_defuse'
          : null

      if (kind && player) {
        const key = `${this.round}:${this.defuse.steamId}:defuse`
        if (!this.fired.has(key)) {
          this.fired.add(key)
          seeds.push({
            kind,
            steamId: player.steamId,
            playerName: player.name,
            side: player.side,
            slot: context.slotOf(player.side),
            mapName,
            round: this.round,
            killCount: player.roundKills,
            clutchAgainst: isNinja ? this.defuse.tAlive : null,
            victims: [],
            weapons: [],
            headshots: 0,
            occurredAt: now,
            weight: HIGHLIGHT_WEIGHT[kind]
          })
        }
      }
    }

    // --- Remontada : gagner en ayant été mené de deux joueurs ou plus ---
    if (winner && this.maxDeficit[winner] >= 2) {
      const hero = reference.players
        .filter((p) => p.side === winner)
        .reduce<NormalizedPlayer | null>(
          (best, p) => (!best || p.roundKills > best.roundKills ? p : best),
          null
        )

      const key = `${this.round}:comeback`
      if (hero && hero.roundKills > 0 && !this.fired.has(key)) {
        this.fired.add(key)
        seeds.push({
          kind: 'comeback_round',
          steamId: hero.steamId,
          playerName: hero.name,
          side: hero.side,
          slot: context.slotOf(hero.side),
          mapName,
          round: this.round,
          killCount: hero.roundKills,
          clutchAgainst: this.maxDeficit[winner],
          victims: [],
          weapons: [],
          headshots: hero.roundHeadshots,
          occurredAt: now,
          weight: HIGHLIGHT_WEIGHT.comeback_round
        })
      }
    }

    return seeds
  }
}

/**
 * Garde le temps fort le plus marquant d'une même manche.
 *
 * Un ace en clutch produit deux graines. Rejouer les deux enchaînerait deux
 * clips de la même action : on ne garde que le plus lourd.
 */
export function pickBestSeed(seeds: HighlightSeed[]): HighlightSeed | null {
  if (seeds.length === 0) return null
  return seeds.reduce((best, seed) => (seed.weight > best.weight ? seed : best))
}
