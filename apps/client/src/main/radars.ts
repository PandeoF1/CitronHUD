import { existsSync, readFileSync, writeFileSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { findSteamPath, readLibraryFolders } from './steam'
import { readVpkEntry, readVpkIndex } from './vpk'
import { decodeVtex, encodePng } from './vtex'

/**
 * Extraction des radars depuis l'installation CS2 locale.
 *
 * Trois raisons de ne pas livrer d'images avec l'application :
 *
 *  1. Elles appartiennent à Valve.
 *  2. Une copie figée se périme dès qu'une carte est remaniée, et un radar
 *     décalé d'un couloir est pire qu'un radar absent.
 *  3. Le jeu contient AUSSI la géométrie officielle de projection
 *     (`resource/overviews/*.txt`) : origine, échelle, rotation. La lire évite
 *     d'entretenir à la main des constantes qui finissent par diverger.
 *
 * Effet de bord appréciable : les cartes de l'atelier et les variantes d'étage
 * (Nuke, Vertigo, Train) arrivent gratuitement.
 */

/** Sous-dossier de CS2 dans une bibliothèque Steam. */
const CS2_RELATIVE = join('steamapps', 'common', 'Counter-Strike Global Offensive')
const OVERVIEW_PREFIX = 'resource/overviews/'
const RADAR_PREFIX = 'panorama/images/overheadmaps/'
const RADAR_SUFFIX = '_radar_psd.vtex_c'

export interface RadarGeometry {
  /** Coordonnée monde du coin haut-gauche de l'image. */
  posX: number
  posY: number
  /** Unités monde par pixel d'image. */
  scale: number
  /** L'image a été tournée de 90° au montage. */
  rotate: number
  /** Étage supérieur d'une carte à niveaux, quand il existe. */
  lower?: { altitudeMax: number }
}

export interface RadarManifest {
  /** Empreinte de l'installation, pour ne pas ré-extraire à chaque lancement. */
  source: string
  extractedAt: string
  maps: Record<string, RadarGeometry & { image: string; lowerImage?: string }>
}

const MANIFEST_NAME = 'radars.json'

/**
 * Altitude sous laquelle on bascule sur le radar d'étage inférieur.
 *
 * Valve ne publie pas ce seuil : il vit dans les fichiers de carte compilés.
 * Ces valeurs sont relevées sur les cartes concernées et n'ont besoin d'être
 * qu'approximativement justes — l'étage bas et l'étage haut sont séparés par
 * plusieurs centaines d'unités de vide.
 */
const LOWER_THRESHOLD: Record<string, number> = {
  de_nuke: -495,
  de_vertigo: 11700,
  de_train: -50
}

/** Vrai si ce dossier est bien une racine d'installation CS2. */
function isCs2Root(path: string): boolean {
  return existsSync(join(path, 'game', 'csgo', 'pak01_dir.vpk'))
}

/**
 * Localise la racine de CS2 à partir d'un chemin quelconque.
 *
 * Le réglage « chemin d'installation » du panneau accepte aussi bien la racine
 * de Steam qu'un dossier de bibliothèque ou le dossier du jeu lui-même — c'est
 * ce que fait déjà la recherche du dossier `cfg`, et un utilisateur qui a
 * renseigné un chemin valide pour le GSI attend légitimement qu'il vaille aussi
 * pour les radars.
 */
function resolveCs2From(path: string): string | null {
  if (isCs2Root(path)) return path

  for (const library of readLibraryFolders(path)) {
    const candidate = join(library, CS2_RELATIVE)
    if (isCs2Root(candidate)) return candidate
  }

  // Chemin pointant à l'intérieur du jeu (`…/game`, `…/game/csgo`) : on remonte.
  let current = path
  for (let depth = 0; depth < 3; depth++) {
    const parent = dirname(current)
    if (parent === current) break
    if (isCs2Root(parent)) return parent
    current = parent
  }

  return null
}

export function findCs2Dir(steamPath?: string | null): string | null {
  if (steamPath) {
    const found = resolveCs2From(steamPath)
    if (found) return found
  }

  const root = findSteamPath()
  return root ? resolveCs2From(root) : null
}

/**
 * Analyse un fichier d'overview Valve.
 *
 * Format KeyValues minimal : des paires `"clé" "valeur"` avec des commentaires
 * `//`. On ne lit que ce qui sert à projeter, le reste (positions des sites,
 * marges de l'écran de chargement) ne concerne pas le HUD.
 */
export function parseOverview(text: string): RadarGeometry | null {
  const read = (key: string): number | null => {
    const match = new RegExp(`"${key}"\\s+"(-?[0-9.]+)"`, 'i').exec(text)
    return match ? Number(match[1]) : null
  }

  const posX = read('pos_x')
  const posY = read('pos_y')
  const scale = read('scale')
  if (posX === null || posY === null || scale === null || scale === 0) return null

  return { posX, posY, scale, rotate: read('rotate') ?? 0 }
}

/** Signature de l'installation : chemin + date du VPK d'index. */
function sourceFingerprint(vpkPath: string): string {
  const stat = statSync(vpkPath)
  return `${vpkPath}@${stat.mtimeMs}:${stat.size}`
}

export function readManifest(target: string): RadarManifest | null {
  const path = join(target, MANIFEST_NAME)
  if (!existsSync(path)) return null
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as RadarManifest
  } catch {
    // Manifeste illisible : on le régénère plutôt que de refuser de démarrer.
    return null
  }
}

export interface ExtractionResult {
  ok: boolean
  message: string
  extracted: number
  skipped: string[]
}

/**
 * Extrait tous les radars disponibles.
 *
 * Idempotent : si l'empreinte de l'installation n'a pas bougé depuis la
 * dernière extraction, on ne refait rien. Une mise à jour du jeu la change et
 * déclenche une régénération complète.
 */
export function extractRadars(
  target: string,
  options: { steamPath?: string | null; force?: boolean } = {}
): ExtractionResult {
  const cs2 = findCs2Dir(options.steamPath)
  if (!cs2) {
    return {
      ok: false,
      extracted: 0,
      skipped: [],
      message: "Installation de CS2 introuvable : les radars resteront vides."
    }
  }

  const vpkPath = join(cs2, 'game', 'csgo', 'pak01_dir.vpk')
  const fingerprint = sourceFingerprint(vpkPath)
  const existing = readManifest(target)
  if (!options.force && existing?.source === fingerprint) {
    return {
      ok: true,
      extracted: Object.keys(existing.maps).length,
      skipped: [],
      message: 'Radars déjà à jour.'
    }
  }

  const { buffer, entries } = readVpkIndex(vpkPath)

  // Géométries d'abord : une carte sans projection connue serait inutilisable
  // même avec son image.
  const geometries = new Map<string, RadarGeometry>()
  for (const [path, entry] of entries) {
    if (!path.startsWith(OVERVIEW_PREFIX) || !path.endsWith('.txt')) continue
    const name = path.slice(OVERVIEW_PREFIX.length, -'.txt'.length)
    const parsed = parseOverview(readVpkEntry(vpkPath, buffer, entry).toString('utf8'))
    if (parsed) geometries.set(name, parsed)
  }

  const maps: RadarManifest['maps'] = {}
  const skipped: string[] = []

  for (const [path, entry] of entries) {
    if (!path.startsWith(RADAR_PREFIX) || !path.endsWith(RADAR_SUFFIX)) continue

    const stem = path.slice(RADAR_PREFIX.length, -RADAR_SUFFIX.length)
    const isLower = stem.endsWith('_lower')
    const name = isLower ? stem.slice(0, -'_lower'.length) : stem

    const geometry = geometries.get(name)
    if (!geometry) {
      // Radar sans fichier d'overview : rien ne dit où le poser.
      skipped.push(`${stem} (pas de géométrie)`)
      continue
    }

    let png: Buffer
    try {
      const decoded = decodeVtex(readVpkEntry(vpkPath, buffer, entry))
      png = encodePng(decoded.rgba, decoded.width, decoded.height)
    } catch (error) {
      skipped.push(`${stem} (${(error as Error).message})`)
      continue
    }

    const file = `${stem}.png`
    writeFileSync(join(target, file), png)

    const record = maps[name] ?? { ...geometry, image: `${name}.png` }
    if (isLower) record.lowerImage = file
    else record.image = file

    const threshold = LOWER_THRESHOLD[name]
    if (threshold !== undefined) record.lower = { altitudeMax: threshold }

    maps[name] = record
  }

  // Une carte dont seul l'étage bas a été extrait n'a pas d'image principale.
  for (const [name, record] of Object.entries(maps)) {
    if (!existsSync(join(target, record.image))) delete maps[name]
  }

  const manifest: RadarManifest = {
    source: fingerprint,
    extractedAt: new Date().toISOString(),
    maps
  }
  writeFileSync(join(target, MANIFEST_NAME), JSON.stringify(manifest, null, 2))

  const count = Object.keys(maps).length
  return {
    ok: count > 0,
    extracted: count,
    skipped,
    message:
      count > 0
        ? `${count} radars extraits de CS2.`
        : "Aucun radar n'a pu être extrait de l'installation CS2."
  }
}
