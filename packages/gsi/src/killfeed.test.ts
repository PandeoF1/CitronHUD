import { describe, expect, it } from 'vitest'
import { KillFeedEngine } from './killfeed'
import { normalizeFrame } from './frame'
import { buildFrame, type SimulatedPlayerSpec } from './simulator'
import type { Side, Slot } from '@citronhud/contracts'

/**
 * Le killfeed est reconstruit par différence entre deux trames — c'est la partie
 * la plus fragile du moteur, et celle qui échouerait en silence à l'antenne :
 * un feed vide ou faux ne lève aucune erreur, il ment simplement.
 */

const slotOf = (side: Side): Slot => (side === 'CT' ? 'left' : 'right')

function ct(index: number, over: Partial<SimulatedPlayerSpec> = {}): SimulatedPlayerSpec {
  return {
    steamId: `7656119${String(2000000000 + index).padStart(10, '0')}`,
    name: `ct${index}`,
    side: 'CT',
    observerSlot: index + 1,
    position: [index * 100, 0, 0],
    activeWeapon: 'weapon_m4a1',
    ...over
  }
}

function t(index: number, over: Partial<SimulatedPlayerSpec> = {}): SimulatedPlayerSpec {
  return {
    steamId: `7656119${String(3000000000 + index).padStart(10, '0')}`,
    name: `t${index}`,
    side: 'T',
    observerSlot: index + 6,
    position: [index * 100, 500, 0],
    activeWeapon: 'weapon_ak47',
    ...over
  }
}

/** Alimente le moteur avec deux trames consécutives et renvoie les kills. */
function diff(before: SimulatedPlayerSpec[], after: SimulatedPlayerSpec[], round = 3) {
  const engine = new KillFeedEngine()
  // Première passe : établit la référence, n'émet rien par construction.
  engine.ingest(normalizeFrame(buildFrame({ round, players: before, phase: 'live' })), slotOf)
  return engine.ingest(normalizeFrame(buildFrame({ round, players: after, phase: 'live' })), slotOf)
}

describe('KillFeedEngine', () => {
  it('reconstruit un kill simple avec la bonne arme', () => {
    const before = [ct(0), t(0)]
    const after = [ct(0, { kills: 1 }), t(0, { health: 0, deaths: 1 })]

    const events = diff(before, after)

    expect(events).toHaveLength(1)
    expect(events[0]!.killer?.name).toBe('ct0')
    expect(events[0]!.victim.name).toBe('t0')
    expect(events[0]!.weapon).toBe('weapon_m4a1')
    expect(events[0]!.weaponLabel).toBe('M4A4')
    expect(events[0]!.teamkill).toBe(false)
    expect(events[0]!.suicide).toBe(false)
  })

  it('déduit le headshot de la progression du compteur par manche', () => {
    const before = [ct(0), t(0)]
    const after = [
      ct(0, { kills: 1, roundKills: 1, roundHeadshots: 1 }),
      t(0, { health: 0, deaths: 1 })
    ]

    const events = diff(before, after)

    expect(events[0]!.headshot).toBe(true)
  })

  it('émet deux évènements quand un joueur signe un doublé dans la même trame', () => {
    const before = [ct(0), t(0), t(1)]
    const after = [
      ct(0, { kills: 2, roundKills: 2 }),
      t(0, { health: 0, deaths: 1 }),
      t(1, { health: 0, deaths: 1 })
    ]

    const events = diff(before, after)

    expect(events).toHaveLength(2)
    expect(events.every((event) => event.killer?.name === 'ct0')).toBe(true)
  })

  it('attribue un seul headshot quand un doublé n’en compte qu’un', () => {
    const before = [ct(0), t(0), t(1)]
    const after = [
      ct(0, { kills: 2, roundKills: 2, roundHeadshots: 1 }),
      t(0, { health: 0, deaths: 1 }),
      t(1, { health: 0, deaths: 1 })
    ]

    const events = diff(before, after)

    expect(events.filter((event) => event.headshot)).toHaveLength(1)
  })

  it('apparie par proximité quand deux tueurs frappent simultanément', () => {
    // ct0 est collé à t0, ct1 est collé à t1 : l'appariement doit suivre la
    // géométrie et non l'ordre d'itération sur les joueurs.
    const before = [
      ct(0, { position: [0, 0, 0] }),
      ct(1, { position: [2000, 0, 0] }),
      t(0, { position: [50, 0, 0] }),
      t(1, { position: [2050, 0, 0] })
    ]
    const after = [
      ct(0, { position: [0, 0, 0], kills: 1 }),
      ct(1, { position: [2000, 0, 0], kills: 1 }),
      t(0, { position: [50, 0, 0], health: 0, deaths: 1 }),
      t(1, { position: [2050, 0, 0], health: 0, deaths: 1 })
    ]

    const events = diff(before, after)

    expect(events).toHaveLength(2)
    const byVictim = new Map(events.map((event) => [event.victim.name, event.killer?.name]))
    expect(byVictim.get('t0')).toBe('ct0')
    expect(byVictim.get('t1')).toBe('ct1')
  })

  it('reconnaît un teamkill à la baisse du compteur de kills', () => {
    const before = [ct(0, { kills: 5 }), ct(1)]
    const after = [ct(0, { kills: 4 }), ct(1, { health: 0, deaths: 1 })]

    const events = diff(before, after)

    expect(events).toHaveLength(1)
    expect(events[0]!.teamkill).toBe(true)
    expect(events[0]!.killer?.name).toBe('ct0')
  })

  it('classe en suicide une mort sans tueur identifiable', () => {
    const before = [ct(0), t(0)]
    const after = [ct(0), t(0, { health: 0, deaths: 1 })]

    const events = diff(before, after)

    expect(events).toHaveLength(1)
    expect(events[0]!.suicide).toBe(true)
    expect(events[0]!.killer).toBeNull()
  })

  it('rattache l’assistance à un adversaire de la victime', () => {
    const before = [ct(0), ct(1), t(0)]
    const after = [ct(0, { kills: 1 }), ct(1, { assists: 1 }), t(0, { health: 0, deaths: 1 })]

    const events = diff(before, after)

    expect(events[0]!.assister?.name).toBe('ct1')
  })

  it('n’émet rien pendant l’échauffement', () => {
    const engine = new KillFeedEngine()
    const players = [ct(0), t(0)]
    engine.ingest(normalizeFrame(buildFrame({ players, phase: 'warmup' })), slotOf)

    const events = engine.ingest(
      normalizeFrame(
        buildFrame({
          players: [ct(0, { kills: 1 }), t(0, { health: 0, deaths: 1 })],
          phase: 'warmup'
        })
      ),
      slotOf
    )

    expect(events).toHaveLength(0)
  })

  it('ignore la trame de bascule de manche, où les compteurs se réinitialisent', () => {
    const engine = new KillFeedEngine()
    engine.ingest(
      normalizeFrame(buildFrame({ round: 4, players: [ct(0), t(0)], phase: 'live' })),
      slotOf
    )

    // Manche suivante : les compteurs par manche retombent à zéro, ce qui
    // produirait des deltas négatifs si on ne détectait pas la transition.
    const events = engine.ingest(
      normalizeFrame(
        buildFrame({
          round: 5,
          players: [ct(0, { kills: 1 }), t(0, { health: 0, deaths: 1 })],
          phase: 'live'
        })
      ),
      slotOf
    )

    expect(events).toHaveLength(0)
  })

  it('repart à zéro au changement de carte', () => {
    const engine = new KillFeedEngine()
    engine.ingest(
      normalizeFrame(buildFrame({ mapName: 'de_mirage', players: [ct(0), t(0)], phase: 'live' })),
      slotOf
    )

    const events = engine.ingest(
      normalizeFrame(
        buildFrame({
          mapName: 'de_nuke',
          players: [ct(0, { kills: 0 }), t(0, { health: 0, deaths: 0 })],
          phase: 'live'
        })
      ),
      slotOf
    )

    expect(events).toHaveLength(0)
    expect(engine.recent).toHaveLength(0)
  })

  it('borne l’historique affiché', () => {
    const engine = new KillFeedEngine({ historySize: 2 })
    let kills = 0
    let deaths = 0

    engine.ingest(normalizeFrame(buildFrame({ players: [ct(0), t(0)], phase: 'live' })), slotOf)

    for (let i = 0; i < 4; i++) {
      kills++
      deaths++
      engine.ingest(
        normalizeFrame(
          buildFrame({
            players: [ct(0, { kills }), t(0, { health: 0, deaths })],
            phase: 'live'
          })
        ),
        slotOf
      )
    }

    expect(engine.recent).toHaveLength(2)
  })
})
