import { describe, expect, it } from 'vitest'
import { RoundReviewTracker, type ReviewContext } from './rounds'
import { MatchStatsTracker } from './stats'
import { normalizeFrame } from './frame'
import { buildFrame, type SimulatedFrameSpec, type SimulatedPlayerSpec } from './simulator'

/**
 * Le bilan est un instantané : sa valeur tient entièrement à l'instant où il est
 * pris. Ces tests vérifient surtout qu'il capture bien la manche écoulée et
 * qu'il disparaît quand la suivante commence.
 */

function member(index: number, side: 'CT' | 'T', over: Partial<SimulatedPlayerSpec> = {}) {
  return {
    steamId: `7656119${String(2000000000 + index).padStart(10, '0')}`,
    name: `p${index}`,
    side,
    observerSlot: index + 1,
    health: 100,
    ...over
  } satisfies SimulatedPlayerSpec
}

function context(over: Partial<ReviewContext> = {}): ReviewContext {
  return {
    slotOf: (side) => (side === 'CT' ? 'left' : 'right'),
    rosterOf: () => undefined,
    stats: new MatchStatsTracker(),
    hidden: new Set(),
    ...over
  }
}

function feed(
  tracker: RoundReviewTracker,
  spec: SimulatedFrameSpec,
  ctx = context()
): ReturnType<RoundReviewTracker['ingest']> {
  return tracker.ingest(normalizeFrame(buildFrame(spec)), ctx)
}

/** Quatre CT et cinq T ; le CT nommé « héros » a fait la manche. */
const ROSTER: SimulatedPlayerSpec[] = [
  member(0, 'CT', { roundKills: 3, roundHeadshots: 2, roundDamage: 289, kills: 14, deaths: 6 }),
  member(1, 'CT', { roundKills: 1, roundDamage: 120, kills: 9, deaths: 8 }),
  member(2, 'CT', { roundDamage: 40, health: 0 }),
  member(3, 'CT', { health: 0 }),
  member(4, 'CT'),
  ...[5, 6, 7, 8, 9].map((i) => member(i, 'T', { health: 0, roundDamage: 60 }))
]

const HERO = ROSTER[0]!.steamId

describe('RoundReviewTracker', () => {
  it('fige le bilan au passage en phase « over »', () => {
    const tracker = new RoundReviewTracker()

    feed(tracker, { phase: 'live', round: 6, players: ROSTER })
    expect(tracker.current).toBeNull()

    const review = feed(tracker, {
      phase: 'over',
      round: 6,
      winTeam: 'CT',
      ctScore: 5,
      tScore: 2,
      roundWins: { '7': 'ct_win_elimination' },
      players: ROSTER
    })

    expect(review).not.toBeNull()
    expect(review!.round).toBe(7)
    expect(review!.winnerSide).toBe('CT')
    expect(review!.winnerSlot).toBe('left')
    expect(review!.reason).toBe('elimination')
    expect(review!.score).toEqual({ left: 5, right: 2 })
    expect(review!.players).toHaveLength(10)
  })

  it('élit le meilleur frappeur du camp vainqueur', () => {
    const tracker = new RoundReviewTracker()

    feed(tracker, { phase: 'live', round: 6, players: ROSTER })
    const review = feed(tracker, { phase: 'over', round: 6, winTeam: 'CT', players: ROSTER })

    expect(review!.mvp?.steamId).toBe(HERO)
    expect(review!.mvp?.kills).toBe(3)
    expect(review!.mvp?.reason).toBe('3 frags')
  })

  it('ne prend pas un joueur du camp perdant, même s’il a mieux joué', () => {
    const tracker = new RoundReviewTracker()

    const players = ROSTER.map((player) =>
      player.side === 'T' && player.observerSlot === 6
        ? { ...player, roundKills: 4, roundDamage: 400 }
        : player
    )

    feed(tracker, { phase: 'live', round: 6, players })
    const review = feed(tracker, { phase: 'over', round: 6, winTeam: 'CT', players })

    expect(review!.mvp?.side).toBe('CT')
    expect(review!.mvp?.steamId).toBe(HERO)
  })

  it('n’élit personne sur une manche gagnée sans un coup porté', () => {
    const tracker = new RoundReviewTracker()

    const players = ROSTER.map((player) =>
      player.side === 'CT'
        ? { ...player, roundKills: 0, roundHeadshots: 0, roundDamage: 0 }
        : player
    )

    feed(tracker, { phase: 'live', round: 6, players })
    const review = feed(tracker, {
      phase: 'over',
      round: 6,
      winTeam: 'CT',
      roundWins: { '7': 'ct_win_time' },
      players
    })

    expect(review!.reason).toBe('time')
    expect(review!.mvp).toBeNull()
  })

  it('laisse le MVP du jeu remplacer le nôtre', () => {
    const tracker = new RoundReviewTracker()

    feed(tracker, { phase: 'live', round: 6, players: ROSTER })
    feed(tracker, { phase: 'over', round: 6, winTeam: 'CT', players: ROSTER })
    expect(tracker.current!.mvp?.steamId).toBe(HERO)

    // CS2 décerne son MVP au deuxième CT — un poseur, un désamorceur : le jeu
    // sait des choses que le comptage de frags ignore.
    const promoted = ROSTER.map((player, index) =>
      index === 1 ? { ...player, mvps: 1 } : player
    )
    const review = feed(tracker, { phase: 'over', round: 6, winTeam: 'CT', players: promoted })

    expect(review!.mvp?.steamId).toBe(ROSTER[1]!.steamId)
  })

  it('efface le bilan quand la manche suivante démarre', () => {
    const tracker = new RoundReviewTracker()

    feed(tracker, { phase: 'live', round: 6, players: ROSTER })
    feed(tracker, { phase: 'over', round: 6, winTeam: 'CT', players: ROSTER })
    expect(tracker.current).not.toBeNull()

    // Le temps de gel garde le bilan : c'est là qu'il se lit.
    feed(tracker, { phase: 'freezetime', round: 7, players: ROSTER })
    expect(tracker.current).not.toBeNull()

    feed(tracker, { phase: 'live', round: 7, players: ROSTER })
    expect(tracker.current).toBeNull()
  })

  it('exclut les joueurs masqués du tableau', () => {
    const tracker = new RoundReviewTracker()
    const ctx = context({ hidden: new Set([ROSTER[4]!.steamId]) })

    feed(tracker, { phase: 'live', round: 6, players: ROSTER }, ctx)
    const review = feed(
      tracker,
      { phase: 'over', round: 6, winTeam: 'CT', players: ROSTER },
      ctx
    )

    expect(review!.players).toHaveLength(9)
    expect(review!.players.some((player) => player.steamId === ROSTER[4]!.steamId)).toBe(false)
  })

  it('reconnaît un désamorçage et une explosion', () => {
    const tracker = new RoundReviewTracker()

    feed(tracker, { phase: 'live', round: 3, players: ROSTER })
    expect(
      feed(tracker, {
        phase: 'over',
        round: 3,
        winTeam: 'CT',
        roundWins: { '4': 'ct_win_defuse' },
        players: ROSTER
      })!.reason
    ).toBe('defuse')

    feed(tracker, { phase: 'live', round: 4, players: ROSTER })
    expect(
      feed(tracker, {
        phase: 'over',
        round: 4,
        winTeam: 'T',
        roundWins: { '5': 't_win_bomb' },
        players: ROSTER
      })!.reason
    ).toBe('bomb')
  })
})
