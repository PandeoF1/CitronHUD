import { describe, expect, it } from 'vitest'
import { CoachDetector } from './coaches'
import { normalizeFrame } from './frame'
import { buildFrame, type SimulatedFrameSpec, type SimulatedPlayerSpec } from './simulator'

/**
 * Masquer un coach est cosmétique ; masquer un vrai joueur ne l'est pas. Ces
 * tests protègent surtout le second cas — un faux positif retire quelqu'un du
 * HUD en pleine manche, sans que personne comprenne pourquoi.
 */

function member(index: number, side: 'CT' | 'T', health: number): SimulatedPlayerSpec {
  return {
    steamId: `7656119${String(3000000000 + index).padStart(10, '0')}`,
    name: `p${index}`,
    side,
    observerSlot: (index % 10) + 1,
    health
  }
}

const CT = [0, 1, 2, 3, 4]
const T = [5, 6, 7, 8, 9]
/** Le sixième homme de l'équipe CT, jamais en vie. */
const COACH = member(10, 'CT', 0)

/** Une équipe CT à six, dont le coach, face à cinq terroristes. */
function withCoach(coachHealth = 0, aliveCt = CT.length): SimulatedPlayerSpec[] {
  return [
    ...CT.map((i, rank) => member(i, 'CT', rank < aliveCt ? 100 : 0)),
    ...T.map((i) => member(i, 'T', 100)),
    { ...COACH, health: coachHealth }
  ]
}

/** Joue une manche complète : temps de gel, jeu, fin. */
function playRound(
  detector: CoachDetector,
  round: number,
  players: SimulatedPlayerSpec[]
): ReadonlySet<string> {
  let result: ReadonlySet<string> = new Set()
  for (const phase of ['freezetime', 'live', 'live', 'over'] as const) {
    result = detector.ingest(normalizeFrame(buildFrame({ phase, round, players })))
  }
  return result
}

describe('CoachDetector', () => {
  it('désigne le sixième homme jamais vivant après deux manches', () => {
    const detector = new CoachDetector()

    playRound(detector, 0, withCoach())
    expect(detector.current.has(COACH.steamId)).toBe(false)

    playRound(detector, 1, withCoach())
    // La deuxième manche est soldée à l'ouverture de la troisième.
    const coaches = playRound(detector, 2, withCoach())

    expect([...coaches]).toEqual([COACH.steamId])
  })

  it('ne masque personne dans une équipe à cinq', () => {
    const detector = new CoachDetector()

    // Un joueur mort dès le début, cinq contre cinq : c'est un joueur, pas un coach.
    const players: SimulatedPlayerSpec[] = [
      ...CT.map((i, rank) => member(i, 'CT', rank === 0 ? 0 : 100)),
      ...T.map((i) => member(i, 'T', 100))
    ]

    for (let round = 0; round < 6; round++) playRound(detector, round, players)

    expect([...detector.current]).toEqual([])
  })

  it('blanchit un sixième joueur dès qu’il est vu vivant', () => {
    const detector = new CoachDetector()

    playRound(detector, 0, withCoach())
    playRound(detector, 1, withCoach())
    playRound(detector, 2, withCoach())
    expect(detector.current.has(COACH.steamId)).toBe(true)

    // Il rentre en jeu : le verdict doit tomber immédiatement.
    playRound(detector, 3, withCoach(100))
    const coaches = playRound(detector, 4, withCoach(100))

    expect(coaches.has(COACH.steamId)).toBe(false)
  })

  it('ne conclut pas sur une seule manche', () => {
    const detector = new CoachDetector()

    playRound(detector, 0, withCoach())
    const coaches = playRound(detector, 1, withCoach())

    expect(coaches.has(COACH.steamId)).toBe(false)
  })

  it('oublie un joueur déconnecté', () => {
    const detector = new CoachDetector()

    playRound(detector, 0, withCoach())
    playRound(detector, 1, withCoach())

    // Le coach quitte le serveur : l'équipe repasse à cinq.
    const spec: SimulatedFrameSpec = {
      phase: 'live',
      round: 2,
      players: [...CT.map((i) => member(i, 'CT', 100)), ...T.map((i) => member(i, 'T', 100))]
    }
    const coaches = detector.ingest(normalizeFrame(buildFrame(spec)))

    expect(coaches.has(COACH.steamId)).toBe(false)
  })
})
