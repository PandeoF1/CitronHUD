import { describe, expect, it } from 'vitest'
import { SideDetector, detectSides } from './sides'
import { normalizeFrame } from './frame'
import { buildFrame, type SimulatedPlayerSpec } from './simulator'

/**
 * La détection des camps décide de quel côté de l'écran chaque équipe apparaît.
 * Une erreur ici inverse tout le HUD en direct : c'est le bug le plus visible
 * que le projet puisse produire.
 */

const LEFT_TEAM = 'team-citron'
const RIGHT_TEAM = 'team-lime'

function roster(entries: Array<[string, string]>) {
  return new Map(entries)
}

function player(id: string, side: 'CT' | 'T', slot: number): SimulatedPlayerSpec {
  return {
    steamId: id,
    name: id.slice(-3),
    side,
    observerSlot: slot
  }
}

/** Cinq contre cinq, chaque équipe entièrement rattachée au roster. */
function fullMatch(leftSide: 'CT' | 'T') {
  const rightSide = leftSide === 'CT' ? 'T' : 'CT'
  const players: SimulatedPlayerSpec[] = []
  const index: Array<[string, string]> = []

  for (let i = 0; i < 5; i++) {
    const leftId = `7656119${String(4000000000 + i).padStart(10, '0')}`
    const rightId = `7656119${String(5000000000 + i).padStart(10, '0')}`
    players.push(player(leftId, leftSide, i + 1))
    players.push(player(rightId, rightSide, i + 6))
    index.push([leftId, LEFT_TEAM], [rightId, RIGHT_TEAM])
  }

  return { players, playerTeam: roster(index) }
}

const context = (playerTeam: Map<string, string>) => ({
  playerTeam,
  leftTeamId: LEFT_TEAM,
  rightTeamId: RIGHT_TEAM
})

describe('detectSides', () => {
  it('reconnaît le camp de l’équipe de gauche avec une confiance totale', () => {
    const { players, playerTeam } = fullMatch('CT')
    const evidence = detectSides(normalizeFrame(buildFrame({ players })), context(playerTeam))

    expect(evidence.leftSide).toBe('CT')
    expect(evidence.confidence).toBe(1)
    expect(evidence.matchedPlayers).toBe(10)
    expect(evidence.blind).toBe(false)
  })

  it('détecte l’inversion après la mi-temps', () => {
    const { players, playerTeam } = fullMatch('T')
    const evidence = detectSides(normalizeFrame(buildFrame({ players })), context(playerTeam))

    expect(evidence.leftSide).toBe('T')
    expect(evidence.confidence).toBe(1)
  })

  it('signale une confiance dégradée quand un joueur est mal rattaché', () => {
    const { players, playerTeam } = fullMatch('CT')
    // Un joueur du roster de gauche est en réalité côté T : 9 voix contre 1.
    const strayId = players[0]!.steamId
    playerTeam.set(strayId, RIGHT_TEAM)

    const evidence = detectSides(normalizeFrame(buildFrame({ players })), context(playerTeam))

    expect(evidence.leftSide).toBe('CT')
    expect(evidence.confidence).toBeCloseTo(0.9, 5)
  })

  it('bascule quand la majorité des rattachements est fausse', () => {
    // Cas concret : un roster importé avec les deux équipes interverties. La
    // détection doit suivre les SteamID, pas la configuration — c'est
    // exactement la situation que le bouton d'inversion manuelle rattrape.
    const { players, playerTeam } = fullMatch('CT')
    for (const [steamId, teamId] of playerTeam) {
      playerTeam.set(steamId, teamId === LEFT_TEAM ? RIGHT_TEAM : LEFT_TEAM)
    }

    const evidence = detectSides(normalizeFrame(buildFrame({ players })), context(playerTeam))

    expect(evidence.leftSide).toBe('T')
    expect(evidence.confidence).toBe(1)
  })

  it('se déclare aveugle quand aucun SteamID n’est connu', () => {
    const { players } = fullMatch('CT')
    const evidence = detectSides(normalizeFrame(buildFrame({ players })), context(new Map()))

    expect(evidence.blind).toBe(true)
    expect(evidence.confidence).toBe(0)
    expect(evidence.matchedPlayers).toBe(0)
  })

  it('reste aveugle sans équipes configurées', () => {
    const { players, playerTeam } = fullMatch('CT')
    const evidence = detectSides(normalizeFrame(buildFrame({ players })), {
      playerTeam,
      leftTeamId: null,
      rightTeamId: null
    })

    expect(evidence.blind).toBe(true)
  })
})

describe('SideDetector', () => {
  it('ne bascule pas sur une seule trame contradictoire', () => {
    const detector = new SideDetector({ leftSide: 'CT' })
    const stable = fullMatch('CT')
    const flipped = fullMatch('T')

    detector.update(normalizeFrame(buildFrame({ players: stable.players })), context(stable.playerTeam))
    // Une trame isolée en désaccord — typiquement une reconnexion en cours.
    detector.update(
      normalizeFrame(buildFrame({ players: flipped.players })),
      context(flipped.playerTeam)
    )

    expect(detector.current.leftSide).toBe('CT')
  })

  it('bascule après cinq trames concordantes', () => {
    const detector = new SideDetector({ leftSide: 'CT' })
    const flipped = fullMatch('T')

    for (let i = 0; i < 5; i++) {
      detector.update(
        normalizeFrame(buildFrame({ players: flipped.players })),
        context(flipped.playerTeam)
      )
    }

    expect(detector.current.leftSide).toBe('T')
    expect(detector.current.mode).toBe('auto')
  })

  it('remet le compteur à zéro si le désaccord ne persiste pas', () => {
    const detector = new SideDetector({ leftSide: 'CT' })
    const stable = fullMatch('CT')
    const flipped = fullMatch('T')

    for (let i = 0; i < 4; i++) {
      detector.update(
        normalizeFrame(buildFrame({ players: flipped.players })),
        context(flipped.playerTeam)
      )
    }
    detector.update(normalizeFrame(buildFrame({ players: stable.players })), context(stable.playerTeam))
    detector.update(
      normalizeFrame(buildFrame({ players: flipped.players })),
      context(flipped.playerTeam)
    )

    expect(detector.current.leftSide).toBe('CT')
  })

  it('inverse à la demande et passe en manuel', () => {
    const detector = new SideDetector({ leftSide: 'CT' })
    const assignment = detector.swap()

    expect(assignment.leftSide).toBe('T')
    expect(assignment.mode).toBe('manual')
    expect(assignment.overridden).toBe(true)
  })

  it('ne laisse pas la détection écraser un choix manuel', () => {
    const detector = new SideDetector({ leftSide: 'CT' })
    detector.swap() // gauche = T, en manuel
    const stable = fullMatch('CT')

    for (let i = 0; i < 10; i++) {
      detector.update(
        normalizeFrame(buildFrame({ players: stable.players })),
        context(stable.playerTeam)
      )
    }

    expect(detector.current.leftSide).toBe('T')
    // La confiance reste publiée pour que le panneau signale le désaccord.
    expect(detector.current.confidence).toBe(1)
  })

  it('reprend la détection automatique à la demande', () => {
    const detector = new SideDetector({ leftSide: 'CT' })
    detector.swap()
    detector.setAuto()
    const stable = fullMatch('CT')

    for (let i = 0; i < 5; i++) {
      detector.update(
        normalizeFrame(buildFrame({ players: stable.players })),
        context(stable.playerTeam)
      )
    }

    expect(detector.current.leftSide).toBe('CT')
    expect(detector.current.mode).toBe('auto')
  })

  it('projette les camps sur les positions d’écran', () => {
    const detector = new SideDetector({ leftSide: 'T' })

    expect(detector.slotOf('T')).toBe('left')
    expect(detector.slotOf('CT')).toBe('right')
    expect(detector.sideOf('left')).toBe('T')
    expect(detector.sideOf('right')).toBe('CT')
  })
})
