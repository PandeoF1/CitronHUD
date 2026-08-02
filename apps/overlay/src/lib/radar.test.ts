import { describe, expect, it } from 'vitest'
import {
  interpolateSnapshots,
  projectToRadar,
  radarImageUrl,
  type RadarGeometry,
  type RadarSnapshot,
  type Vec3
} from './radar'

/**
 * La projection décide de l'endroit exact où chaque joueur apparaît : une erreur
 * ici décale tout le radar sans rien casser de visible ailleurs. L'interpolation,
 * elle, est ce qui rend le radar fluide — et la faire dépendre d'un retard fixe
 * la fige dès que les trames arrivent plus vite que prévu.
 */

/** Géométrie officielle de Mirage, relevée dans `resource/overviews`. */
const MIRAGE: RadarGeometry = {
  posX: -3230,
  posY: 1713,
  scale: 5,
  image: 'de_mirage.png'
}

const NUKE: RadarGeometry = {
  posX: -3453,
  posY: 2887,
  scale: 7,
  image: 'de_nuke.png',
  lowerImage: 'de_nuke_lower.png',
  lower: { altitudeMax: -495 }
}

function snapshot(at: number, entries: Array<[string, Vec3]>, bomb: Vec3 | null = null): RadarSnapshot {
  return { at, positions: new Map(entries), bomb }
}

describe('projectToRadar', () => {
  it('place l’origine de la carte au coin haut-gauche', () => {
    expect(projectToRadar([MIRAGE.posX, MIRAGE.posY, 0], MIRAGE)).toEqual({ x: 0, y: 0 })
  })

  it('couvre exactement l’image sur toute l’étendue de la carte', () => {
    const span = MIRAGE.scale * 1024
    const corner = projectToRadar([MIRAGE.posX + span, MIRAGE.posY - span, 0], MIRAGE)

    expect(corner.x).toBeCloseTo(1)
    expect(corner.y).toBeCloseTo(1)
  })

  it('inverse l’axe Y — le monde monte, l’image descend', () => {
    const north = projectToRadar([0, 1000, 0], MIRAGE)
    const south = projectToRadar([0, -1000, 0], MIRAGE)

    expect(north.y).toBeLessThan(south.y)
  })
})

describe('radarImageUrl', () => {
  it('reste sur l’étage principal quand la carte n’en a qu’un', () => {
    expect(radarImageUrl(MIRAGE, -9999)).toBe('./radars/de_mirage.png')
  })

  it('bascule sous le seuil d’altitude', () => {
    expect(radarImageUrl(NUKE, 0)).toBe('./radars/de_nuke.png')
    expect(radarImageUrl(NUKE, -600)).toBe('./radars/de_nuke_lower.png')
  })

  it('garde l’étage principal quand l’altitude est inconnue', () => {
    expect(radarImageUrl(NUKE, null)).toBe('./radars/de_nuke.png')
  })
})

describe('interpolateSnapshots', () => {
  const previous = snapshot(1000, [['a', [0, 0, 0]]], [100, 100, 0])
  const latest = snapshot(1100, [['a', [100, 200, 0]]], [200, 300, 0])

  it('affiche l’avant-dernière position à l’arrivée de la dernière', () => {
    const result = interpolateSnapshots(previous, latest, 1100)
    expect(result!.positions.get('a')).toEqual([0, 0, 0])
  })

  it('atteint la dernière position après un intervalle complet', () => {
    const result = interpolateSnapshots(previous, latest, 1200)
    expect(result!.positions.get('a')).toEqual([100, 200, 0])
  })

  it('progresse linéairement entre les deux', () => {
    const result = interpolateSnapshots(previous, latest, 1150)
    expect(result!.positions.get('a')).toEqual([50, 100, 0])
    expect(result!.bomb).toEqual([150, 200, 0])
  })

  /*
   * Le cas qui condamnait un retard fixe : à 30 trames par seconde l'intervalle
   * tombe à 33 ms, bien en deçà de tout décalage constant raisonnable. La
   * progression doit rester utile, sans quoi le radar se fige au lieu de lisser.
   */
  it('reste fluide à cadence élevée', () => {
    const fast = [snapshot(0, [['a', [0, 0, 0]]]), snapshot(33, [['a', [33, 0, 0]]])] as const
    const midway = interpolateSnapshots(fast[0], fast[1], 49.5)

    expect(midway!.positions.get('a')![0]).toBeCloseTo(16.5)
  })

  it('n’extrapole jamais au-delà de la dernière position connue', () => {
    const result = interpolateSnapshots(previous, latest, 5000)
    expect(result!.positions.get('a')).toEqual([100, 200, 0])
  })

  it('affiche directement un joueur apparu sur la dernière trame', () => {
    const arriving = snapshot(1100, [['b', [10, 20, 30]]])
    const result = interpolateSnapshots(previous, arriving, 1150)

    expect(result!.positions.get('b')).toEqual([10, 20, 30])
  })

  it('renonce sans deux instantanés exploitables', () => {
    expect(interpolateSnapshots(null, latest, 1100)).toBeNull()
    expect(interpolateSnapshots(previous, null, 1100)).toBeNull()
    // Deux trames au même instant : aucune durée sur laquelle étaler le trajet.
    expect(interpolateSnapshots(previous, snapshot(1000, []), 1000)).toBeNull()
  })
})
