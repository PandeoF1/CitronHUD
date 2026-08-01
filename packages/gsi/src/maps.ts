/**
 * Cartes — libellés d'affichage.
 *
 * Le GSI renvoie parfois un chemin complet (`/path/to/de_mirage`) selon
 * l'origine du serveur : on ne garde que le dernier segment avant de résoudre.
 */

const MAP_LABELS: Record<string, string> = {
  de_ancient: 'Ancient',
  de_anubis: 'Anubis',
  de_cache: 'Cache',
  de_dust2: 'Dust II',
  de_inferno: 'Inferno',
  de_mirage: 'Mirage',
  de_nuke: 'Nuke',
  de_overpass: 'Overpass',
  de_train: 'Train',
  de_vertigo: 'Vertigo',
  de_cbble: 'Cobblestone',
  de_jura: 'Jura',
  de_basalt: 'Basalt',
  de_edin: 'Edin',
  de_grail: 'Grail',
  cs_italy: 'Italy',
  cs_office: 'Office',
  de_shortdust: 'Shortdust'
}

/** Ne garde que le nom de carte, sans le chemin qui le précède parfois. */
export function mapKey(raw: string | null | undefined): string {
  if (!raw) return ''
  const cut = raw.lastIndexOf('/')
  return cut === -1 ? raw : raw.slice(cut + 1)
}

export function mapLabel(raw: string | null | undefined): string {
  const key = mapKey(raw)
  if (!key) return ''
  const known = MAP_LABELS[key]
  if (known) return known
  // Carte communautaire : « de_ma_map » → « Ma Map ».
  return key
    .replace(/^(de|cs|ar|dz)_/, '')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

/** Le pool actif, pour les listes de veto de l'admin. */
export const ACTIVE_DUTY = [
  'de_ancient',
  'de_dust2',
  'de_inferno',
  'de_mirage',
  'de_nuke',
  'de_overpass',
  'de_train'
] as const
