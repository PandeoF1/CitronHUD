/**
 * Géométrie du radar.
 *
 * CS2 publie pour chaque carte une origine et une échelle qui projettent les
 * coordonnées monde vers l'image de radar 1024×1024. Ces valeurs viennent des
 * fichiers `resource/overviews/*.txt` du jeu ; elles sont stables d'une mise à
 * jour à l'autre, sauf refonte complète de la carte.
 */

export interface RadarGeometry {
  /** Coordonnée monde du coin haut-gauche de l'image. */
  posX: number
  posY: number
  /** Unités monde par pixel d'image. */
  scale: number
}

const RADAR_GEOMETRY: Record<string, RadarGeometry> = {
  de_ancient: { posX: -2953, posY: 2164, scale: 5 },
  de_anubis: { posX: -2796, posY: 3328, scale: 5.22 },
  de_cache: { posX: -2000, posY: 3250, scale: 5.5 },
  de_dust2: { posX: -2476, posY: 3239, scale: 4.4 },
  de_inferno: { posX: -2087, posY: 3870, scale: 4.9 },
  de_mirage: { posX: -3230, posY: 1713, scale: 5 },
  de_nuke: { posX: -3453, posY: 2887, scale: 7 },
  de_overpass: { posX: -4831, posY: 1781, scale: 5.2 },
  de_train: { posX: -2308, posY: 2078, scale: 4.082 },
  de_vertigo: { posX: -3168, posY: 1762, scale: 4 }
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

export function radarGeometry(mapName: string | null | undefined): RadarGeometry | null {
  const key = mapKey(mapName)
  return key ? (RADAR_GEOMETRY[key] ?? null) : null
}

/**
 * Projette une position monde vers des coordonnées 0→1 dans l'image.
 *
 * L'axe Y est inversé : le monde croît vers le nord, l'image vers le bas.
 */
export function projectToRadar(
  position: readonly [number, number, number],
  geometry: RadarGeometry
): { x: number; y: number } {
  const x = (position[0] - geometry.posX) / geometry.scale / RADAR_IMAGE_SIZE
  const y = (geometry.posY - position[1]) / geometry.scale / RADAR_IMAGE_SIZE
  return { x, y }
}

/**
 * URL de l'image de radar.
 *
 * Servie par le client local depuis ses ressources. Absente, le composant
 * bascule sur un repli lisible plutôt que d'afficher un cadre vide : mieux vaut
 * dire « radar indisponible » que laisser croire à un bug d'affichage.
 */
export function radarImageUrl(mapName: string | null | undefined): string | null {
  const key = mapKey(mapName)
  return key ? `./radars/${key}.png` : null
}
