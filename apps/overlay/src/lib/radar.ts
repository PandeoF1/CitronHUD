/**
 * Géométrie du radar.
 *
 * CS2 publie pour chaque carte une origine et une échelle qui projettent les
 * coordonnées monde vers l'image de radar 1024×1024. Ces valeurs viennent des
 * fichiers `resource/overviews/*.txt` du jeu.
 *
 * Le client extrait ces fichiers de l'installation locale et les publie sous
 * `./radars/radars.json`. On les préfère toujours aux constantes ci-dessous :
 * elles suivent les refontes de carte, couvrent les cartes de l'atelier et les
 * variantes d'étage. Les constantes ne servent que de repli quand l'extraction
 * n'a pas pu tourner (CS2 absent de la machine du streamer, par exemple).
 */

export interface RadarGeometry {
  /** Coordonnée monde du coin haut-gauche de l'image. */
  posX: number
  posY: number
  /** Unités monde par pixel d'image. */
  scale: number
  /** Fichier du radar principal, relatif à `./radars/`. */
  image: string
  /** Radar d'étage inférieur, quand la carte en a un. */
  lowerImage?: string
  /** Altitude sous laquelle basculer sur `lowerImage`. */
  lower?: { altitudeMax: number }
}

interface RadarManifest {
  maps: Record<string, RadarGeometry>
}

/**
 * Repli hors ligne, relevé sur les fichiers d'overview de CS2.
 *
 * Volontairement limité à la pool compétitive : au-delà, une valeur devinée
 * placerait les joueurs au mauvais endroit, ce qui est pire qu'un radar absent.
 */
const FALLBACK_GEOMETRY: Record<string, RadarGeometry> = {
  de_ancient: { posX: -2953, posY: 2164, scale: 5, image: 'de_ancient.png' },
  de_anubis: { posX: -2796, posY: 3328, scale: 5.22, image: 'de_anubis.png' },
  de_cache: { posX: -2000, posY: 3250, scale: 5.5, image: 'de_cache.png' },
  de_dust2: { posX: -2476, posY: 3239, scale: 4.4, image: 'de_dust2.png' },
  de_inferno: { posX: -2087, posY: 3870, scale: 4.9, image: 'de_inferno.png' },
  de_mirage: { posX: -3230, posY: 1713, scale: 5, image: 'de_mirage.png' },
  de_nuke: {
    posX: -3453,
    posY: 2887,
    scale: 7,
    image: 'de_nuke.png',
    lowerImage: 'de_nuke_lower.png',
    lower: { altitudeMax: -495 }
  },
  de_overpass: { posX: -4831, posY: 1781, scale: 5.2, image: 'de_overpass.png' },
  de_train: {
    posX: -2308,
    posY: 2078,
    scale: 4.082,
    image: 'de_train.png',
    lowerImage: 'de_train_lower.png',
    lower: { altitudeMax: -50 }
  },
  de_vertigo: {
    posX: -3168,
    posY: 1762,
    scale: 4,
    image: 'de_vertigo.png',
    lowerImage: 'de_vertigo_lower.png',
    lower: { altitudeMax: 11700 }
  }
}

/** Taille de l'image de radar fournie par le jeu. */
export const RADAR_IMAGE_SIZE = 1024

/**
 * Ne garde que le nom de carte, sans le chemin qui le précède parfois.
 *
 * Dupliqué depuis `@citronhud/gsi` volontairement : ce paquet est orienté Node
 * et l'importer ici tirerait le moteur entier dans le bundle chargé par OBS,
 * pour quatre lignes de découpage de chaîne.
 */
function mapKey(raw: string | null | undefined): string {
  if (!raw) return ''
  const cut = raw.lastIndexOf('/')
  return cut === -1 ? raw : raw.slice(cut + 1)
}

let manifestPromise: Promise<Record<string, RadarGeometry>> | null = null

/**
 * Charge le manifeste extrait par le client.
 *
 * Une seule fois par session : le manifeste ne change qu'à la réinstallation
 * des radars, qui recharge de toute façon l'overlay.
 */
export function loadRadarGeometries(): Promise<Record<string, RadarGeometry>> {
  manifestPromise ??= fetch('./radars/radars.json')
    .then((response) => (response.ok ? (response.json() as Promise<RadarManifest>) : null))
    .then((manifest) => ({ ...FALLBACK_GEOMETRY, ...(manifest?.maps ?? {}) }))
    .catch(() => FALLBACK_GEOMETRY)
  return manifestPromise
}

export function radarGeometry(
  mapName: string | null | undefined,
  geometries: Record<string, RadarGeometry>
): RadarGeometry | null {
  const key = mapKey(mapName)
  return key ? (geometries[key] ?? null) : null
}

/**
 * Choisit l'image à afficher selon l'altitude du jeu.
 *
 * Nuke, Vertigo et Train se jouent sur deux étages superposés : projetés sur
 * une seule image, les deux niveaux se confondent. On suit l'altitude du joueur
 * observé plutôt qu'une moyenne d'équipe — c'est l'action qu'on commente qui
 * doit rester lisible.
 */
export function radarImageUrl(geometry: RadarGeometry, altitude: number | null): string {
  const useLower =
    geometry.lowerImage !== undefined &&
    geometry.lower !== undefined &&
    altitude !== null &&
    altitude < geometry.lower.altitudeMax
  return `./radars/${useLower ? geometry.lowerImage : geometry.image}`
}

export type Vec3 = readonly [number, number, number]

/** Instantané de positions, tel qu'il arrive du client. */
export interface RadarSnapshot {
  /** Horodatage local de réception, en millisecondes monotones. */
  at: number
  positions: ReadonlyMap<string, Vec3>
  bomb: Vec3 | null
}

/** Interpolation linéaire entre deux positions monde. */
function lerp(from: Vec3, to: Vec3, t: number): Vec3 {
  return [
    from[0] + (to[0] - from[0]) * t,
    from[1] + (to[1] - from[1]) * t,
    from[2] + (to[2] - from[2]) * t
  ]
}

/**
 * Positions lissées à l'instant `now`, ou `null` si rien n'est interpolable.
 *
 * On rend systématiquement une trame en retard : le trajet de l'avant-dernière
 * position vers la dernière est étalé sur la durée qui les a séparées. Le retard
 * s'aligne donc tout seul sur la cadence réelle du flux, qui varie beaucoup —
 * CS2 n'émet que sur changement, et le réglage `throttle` n'en fixe que le
 * plafond. Un retard constant, lui, gèlerait le radar dès que les trames
 * arriveraient plus vite que lui.
 */
export function interpolateSnapshots(
  previous: RadarSnapshot | null,
  latest: RadarSnapshot | null,
  now: number
): { positions: Map<string, Vec3>; bomb: Vec3 | null } | null {
  if (!previous || !latest) return null

  const span = latest.at - previous.at
  if (span <= 0) return null

  // Borné à 1 : passé la cible, on extrapolerait. Une trame en retard ferait
  // alors dépasser les pastilles, puis reculer — bien pire que le saut d'origine.
  const t = Math.min(1, Math.max(0, (now - latest.at) / span))

  const positions = new Map<string, Vec3>()
  for (const [steamId, to] of latest.positions) {
    const from = previous.positions.get(steamId)
    positions.set(steamId, from ? lerp(from, to, t) : to)
  }

  const bomb =
    latest.bomb && previous.bomb ? lerp(previous.bomb, latest.bomb, t) : (latest.bomb ?? null)

  return { positions, bomb }
}

/**
 * Projette une position monde vers des coordonnées 0→1 dans l'image.
 *
 * L'axe Y est inversé : le monde croît vers le nord, l'image vers le bas.
 *
 * Le champ `rotate` des fichiers d'overview n'entre pas ici : il pilotait
 * l'ancienne carte d'ensemble de CS:GO, alors que les textures Panorama sont
 * déjà livrées dans l'orientation de la projection. Vérifié sur Dust2, dont les
 * deux sites tombent exactement sur leurs zones peintes.
 */
export function projectToRadar(
  position: readonly [number, number, number],
  geometry: RadarGeometry
): { x: number; y: number } {
  const x = (position[0] - geometry.posX) / geometry.scale / RADAR_IMAGE_SIZE
  const y = (geometry.posY - position[1]) / geometry.scale / RADAR_IMAGE_SIZE
  return { x, y }
}
