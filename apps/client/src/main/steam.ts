import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, basename } from 'node:path'
import { homedir, platform } from 'node:os'

/**
 * Détection de Steam et installation du fichier Game State Integration.
 *
 * C'est l'étape qui fait abandonner les streamers avec les autres HUDs :
 * « ouvrez ce dossier, créez ce fichier, collez ce contenu ». On la supprime en
 * localisant CS2 tout seul, y compris quand le jeu est sur une bibliothèque
 * secondaire — cas très courant, le jeu étant souvent sur un SSD séparé.
 */

/** AppID de Counter-Strike 2. */
const CS2_APP_ID = '730'
const CS2_CFG_RELATIVE = join('steamapps', 'common', 'Counter-Strike Global Offensive', 'game', 'csgo', 'cfg')

/** Emplacements par défaut de Steam, par système. */
function defaultSteamPaths(): string[] {
  const home = homedir()
  switch (platform()) {
    case 'win32':
      return [
        'C:\\Program Files (x86)\\Steam',
        'C:\\Program Files\\Steam',
        join(home, 'scoop', 'apps', 'steam', 'current')
      ]
    case 'darwin':
      return [join(home, 'Library', 'Application Support', 'Steam')]
    default:
      return [
        join(home, '.steam', 'steam'),
        join(home, '.local', 'share', 'Steam'),
        join(home, '.var', 'app', 'com.valvesoftware.Steam', '.local', 'share', 'Steam')
      ]
  }
}

/**
 * Lit les bibliothèques déclarées dans `libraryfolders.vdf`.
 *
 * Le VDF est un format maison de Valve ; on n'en extrait que les chemins, ce
 * qui ne justifie pas une dépendance de parsing complète.
 */
function readLibraryFolders(steamPath: string): string[] {
  const vdf = join(steamPath, 'steamapps', 'libraryfolders.vdf')
  if (!existsSync(vdf)) return [steamPath]

  try {
    const content = readFileSync(vdf, 'utf8')
    const paths = [...content.matchAll(/"path"\s+"([^"]+)"/g)].map((match) =>
      match[1]!.replace(/\\\\/g, '\\')
    )
    return [steamPath, ...paths]
  } catch {
    return [steamPath]
  }
}

/** Localise l'installation de Steam, ou null si introuvable. */
export function findSteamPath(): string | null {
  return defaultSteamPaths().find((candidate) => existsSync(candidate)) ?? null
}

function checkPathForCfg(targetPath: string): string | null {
  if (!existsSync(targetPath)) return null

  const base = basename(targetPath).toLowerCase()

  // 1. Si l'utilisateur pointe directement vers le dossier `cfg`
  if (base === 'cfg') return targetPath

  // 2. Si le chemin pointe vers le sous-dossier `csgo`
  if (base === 'csgo') {
    const cfg = join(targetPath, 'cfg')
    if (existsSync(cfg)) return cfg
  }

  // 3. Si le chemin pointe vers le dossier `game`
  const gameCsgoCfg = join(targetPath, 'csgo', 'cfg')
  if (existsSync(gameCsgoCfg)) return gameCsgoCfg

  // 4. Si le chemin pointe vers la racine de CS2 (Counter-Strike Global Offensive)
  const fullGameCfg = join(targetPath, 'game', 'csgo', 'cfg')
  if (existsSync(fullGameCfg)) return fullGameCfg

  // 5. Si le chemin pointe vers la racine Steam ou un dossier de bibliothèque Steam
  const relativeCfg = join(targetPath, CS2_CFG_RELATIVE)
  if (existsSync(relativeCfg)) return relativeCfg

  // 6. Recherche via libraryfolders.vdf
  for (const library of readLibraryFolders(targetPath)) {
    if (library === targetPath) continue
    const manifest = join(library, 'steamapps', `appmanifest_${CS2_APP_ID}.acf`)
    const cfg = join(library, CS2_CFG_RELATIVE)
    if (existsSync(cfg) && (existsSync(manifest) || library === targetPath)) return cfg
  }

  return null
}

/**
 * Localise le dossier `cfg` de CS2.
 *
 * Parcourt la configuration personnalisée (si valide) ou localise Steam automatiquement.
 */
export function findCs2CfgDir(steamPath?: string | null): string | null {
  if (steamPath) {
    const customCfg = checkPathForCfg(steamPath)
    if (customCfg) return customCfg
  }

  const root = findSteamPath()
  if (!root) return null
  return checkPathForCfg(root)
}

export const GSI_FILE_NAME = 'gamestate_integration_citronhud.cfg'

/**
 * Contenu du fichier GSI.
 *
 * `throttle` à 0.1 s est le meilleur compromis : plus lent, le killfeed
 * reconstruit rate des kills simultanés ; plus rapide, CS2 renvoie des trames
 * identiques et on brûle du CPU pour rien.
 */
function gsiConfig(port: number): string {
  return `"CitronHUD"
{
  "uri"       "http://127.0.0.1:${port}/gsi"
  "timeout"   "5.0"
  "buffer"    "0.1"
  "throttle"  "0.1"
  "heartbeat" "10.0"
  "data"
  {
    "provider"                 "1"
    "map"                      "1"
    "round"                    "1"
    "player_id"                "1"
    "player_state"             "1"
    "player_weapons"           "1"
    "player_match_stats"       "1"
    "allplayers_id"            "1"
    "allplayers_state"         "1"
    "allplayers_match_stats"   "1"
    "allplayers_weapons"       "1"
    "allplayers_position"      "1"
    "phase_countdowns"         "1"
    "allgrenades"              "1"
    "bomb"                     "1"
  }
}
`
}

export interface GsiInstallResult {
  ok: boolean
  path: string | null
  /** Message prêt à afficher — le panneau ne réécrit pas les diagnostics. */
  message: string
}

/**
 * Écrit le fichier GSI dans CS2.
 *
 * Réécrit systématiquement plutôt que de vérifier l'existence : le port peut
 * avoir changé depuis la dernière installation, et un fichier obsolète produit
 * un HUD muet que personne ne sait diagnostiquer.
 */
export function installGsiConfig(port: number, steamPath?: string | null): GsiInstallResult {
  const cfgDir = findCs2CfgDir(steamPath)
  if (!cfgDir) {
    return {
      ok: false,
      path: null,
      message:
        "Dossier de configuration de CS2 introuvable. Indiquez le chemin d'installation de Steam dans les réglages."
    }
  }

  const target = join(cfgDir, GSI_FILE_NAME)
  try {
    mkdirSync(cfgDir, { recursive: true })
    writeFileSync(target, gsiConfig(port), 'utf8')
    return {
      ok: true,
      path: target,
      message: 'Configuration GSI installée. Redémarrez CS2 s\u2019il est déjà lancé.'
    }
  } catch (error) {
    return {
      ok: false,
      path: target,
      message: `Écriture impossible dans ${cfgDir} : ${(error as Error).message}`
    }
  }
}

/** Vrai si le fichier GSI est présent et pointe vers le port attendu. */
export function isGsiInstalled(port: number, steamPath?: string | null): boolean {
  const cfgDir = findCs2CfgDir(steamPath)
  if (!cfgDir) return false
  const target = join(cfgDir, GSI_FILE_NAME)
  if (!existsSync(target)) return false
  try {
    return readFileSync(target, 'utf8').includes(`:${port}/gsi`)
  } catch {
    return false
  }
}
