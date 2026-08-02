import { app } from 'electron'
import { join } from 'node:path'
import { existsSync, mkdirSync } from 'node:fs'

/**
 * Emplacements sur disque.
 *
 * Tout est regroupé ici pour qu'aucun module n'invente son propre chemin :
 * c'est la première chose qui diverge quand on doit purger les clips ou
 * expliquer à un streamer où trouver ses données.
 */

function ensure(dir: string): string {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

/** Racine des données utilisateur (AppData sur Windows, ~/.config sur Linux). */
export const userDataDir = (): string => ensure(app.getPath('userData'))

/** Base SQLite : cache du roster, journal d'évènements, file d'envoi. */
export const databasePath = (): string => join(userDataDir(), 'citronhud.db')

/** Réglages du client, en JSON lisible pour un dépannage à distance. */
export const settingsPath = (): string => join(userDataDir(), 'settings.json')

/** Clips vidéo des temps forts, avant et après découpe. */
export const clipsDir = (): string => ensure(join(userDataDir(), 'clips'))

/** Captures brutes du tampon interne, purgées en continu. */
export const captureDir = (): string => ensure(join(userDataDir(), 'capture'))

/**
 * Bundle de l'overlay servi à OBS.
 *
 * Deux emplacements possibles : celui livré avec l'application, et celui
 * téléchargé depuis le serveur. Le second gagne quand il existe, ce qui permet
 * de corriger l'apparence du HUD sans republier un installeur.
 */
export const bundledOverlayDir = (): string => {
  const candidates = [
    join(app.getAppPath(), 'resources/overlay'),
    join(process.resourcesPath ?? '', 'overlay'),
    join(__dirname, '../../../overlay/dist')
  ]
  return candidates.find((candidate) => existsSync(candidate)) ?? candidates[candidates.length - 1]!
}

export const downloadedOverlayDir = (): string => ensure(join(userDataDir(), 'overlay'))

/** Le dossier réellement servi : le téléchargé s'il est complet, sinon le livré. */
export function activeOverlayDir(): string {
  const downloaded = downloadedOverlayDir()
  return existsSync(join(downloaded, 'index.html')) ? downloaded : bundledOverlayDir()
}

/**
 * Radars extraits de l'installation CS2 locale.
 *
 * Ils ne sont pas livrés avec l'application : les images d'overview
 * appartiennent à Valve, et une copie figée se périmerait au premier
 * remaniement de carte. On les tire du jeu de l'utilisateur, ce qui donne aussi
 * les cartes de l'atelier et les variantes d'étage.
 */
export const radarsDir = (): string => ensure(join(userDataDir(), 'radars'))
