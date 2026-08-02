import { describe, expect, it } from 'vitest'
import { GrenadeTracker } from './grenades'
import { normalizeFrame } from './frame'
import { buildFrame, demoPlayers } from './simulator'
import type { RawGrenade } from './types'

/**
 * Le suivi des utilitaires est de la mémoire pure : le GSI ne dit jamais d'où
 * vient un projectile. Ces tests portent donc sur ce que le tracker ajoute au
 * flux — la traînée — et sur ce qu'il doit oublier.
 */

const PLAYERS = demoPlayers()
const CT_OWNER = PLAYERS[0]!.steamId
const T_OWNER = PLAYERS[7]!.steamId

const sideOf = (steamId: string): 'CT' | 'T' | null =>
  PLAYERS.find((player) => player.steamId === steamId)?.side ?? null

function ingest(
  tracker: GrenadeTracker,
  grenades: Record<string, RawGrenade>,
  round = 0
): ReturnType<GrenadeTracker['ingest']> {
  return tracker.ingest(normalizeFrame(buildFrame({ round, players: PLAYERS, grenades })), sideOf)
}

/** Un projectile en vol à la position donnée. */
function flying(x: number, owner = T_OWNER, type = 'smoke'): RawGrenade {
  return {
    owner,
    type,
    position: `${x}.0, 500.0, 60.0`,
    velocity: '400.0, 0.0, -50.0',
    lifetime: '0.8'
  }
}

describe('GrenadeTracker', () => {
  it('accumule la traînée d’un projectile en vol', () => {
    const tracker = new GrenadeTracker()

    ingest(tracker, { '1': flying(100) })
    ingest(tracker, { '1': flying(200) })
    const [grenade] = ingest(tracker, { '1': flying(300) })

    expect(grenade!.trail).toEqual([
      [100, 500, 60],
      [200, 500, 60],
      [300, 500, 60]
    ])
    expect(grenade!.side).toBe('T')
  })

  it('n’allonge pas la traînée d’un projectile immobile', () => {
    const tracker = new GrenadeTracker()

    const resting: RawGrenade = {
      owner: CT_OWNER,
      type: 'smoke',
      position: '400.0, 500.0, 0.0',
      velocity: '0.0, 0.0, 0.0',
      effecttime: '2.5'
    }

    ingest(tracker, { '1': resting })
    const [grenade] = ingest(tracker, { '1': resting })

    expect(grenade!.trail).toEqual([])
  })

  it('marque une fumée déployée et lui donne un rayon', () => {
    const tracker = new GrenadeTracker()

    const [flight] = ingest(tracker, { '1': flying(100) })
    expect(flight!.active).toBe(false)
    expect(flight!.radius).toBe(0)

    const [popped] = ingest(tracker, {
      '1': { owner: T_OWNER, type: 'smoke', position: '100.0, 500.0, 0.0', effecttime: '1.2' }
    })
    expect(popped!.active).toBe(true)
    expect(popped!.radius).toBeGreaterThan(0)
  })

  it('fond la molotov et sa nappe sous un seul type', () => {
    const tracker = new GrenadeTracker()

    const [fire] = ingest(tracker, {
      '1': {
        owner: CT_OWNER,
        type: 'inferno',
        flames: { flame_0: '10.0, 20.0, 0.0', flame_1: '30.0, 40.0, 0.0' }
      }
    })

    expect(fire!.type).toBe('incendiary')
    expect(fire!.active).toBe(true)
    expect(fire!.flames).toEqual([
      [10, 20, 0],
      [30, 40, 0]
    ])
  })

  it('purge les traînées au changement de manche', () => {
    const tracker = new GrenadeTracker()

    ingest(tracker, { '1': flying(100) }, 4)
    ingest(tracker, { '1': flying(200) }, 4)

    // CS2 recycle les identifiants : sans purge, la nouvelle manche hériterait
    // d'une trace reliant deux lancers sans rapport.
    const [grenade] = ingest(tracker, { '1': flying(900) }, 5)

    expect(grenade!.trail).toEqual([[900, 500, 60]])
  })

  it('oublie un projectile disparu du flux', () => {
    const tracker = new GrenadeTracker()

    ingest(tracker, { '1': flying(100) })
    ingest(tracker, { '1': flying(200) })
    ingest(tracker, {})
    const [grenade] = ingest(tracker, { '1': flying(700) })

    expect(grenade!.trail).toEqual([[700, 500, 60]])
  })

  it('ignore un type inconnu plutôt que de le dessiner au hasard', () => {
    const tracker = new GrenadeTracker()

    const result = ingest(tracker, {
      '1': { owner: CT_OWNER, type: 'something_new', position: '0.0, 0.0, 0.0' }
    })

    expect(result).toEqual([])
  })
})
