import { app } from 'electron'
import { autoUpdater } from 'electron-updater'
import AdmZip from 'adm-zip'
import { createWriteStream, existsSync } from 'node:fs'
import { rm, mkdir, rename } from 'node:fs/promises'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { join } from 'node:path'
import { API_ROUTES } from '@citronhud/contracts'
import { downloadedOverlayDir } from './paths'
import { getClientSettings } from './settings'

/**
 * Mises à jour — à deux vitesses.
 *
 * L'application elle-même passe par `electron-updater` (GitHub Releases), ce
 * qui demande un redémarrage. Mais l'apparence du HUD change beaucoup plus
 * souvent que son moteur : le bundle d'overlay se met donc à jour tout seul,
 * sans réinstaller le client ni interrompre quoi que ce soit.
 *
 * Concrètement, corriger un espacement dans le HUD ne coûte plus une release.
 */

export interface UpdaterEvents {
  onStatus: (status: string) => void
  /** Le bundle d'overlay a changé : les sources navigateur doivent recharger. */
  onOverlayUpdated: () => void
}

export function setupAppUpdater(events: UpdaterEvents): void {
  /*
   * Hors installation empaquetée il n'existe ni version applicative valable ni
   * canal de publication : le seul accès au module `autoUpdater` lève alors
   * ERR_UPDATER_INVALID_VERSION. Sortir avant l'import évite de faire échouer
   * tout le démarrage pour une fonctionnalité qui n'a de sens qu'en production.
   */
  if (!app.isPackaged) return

  const settings = getClientSettings()
  if (!settings.autoUpdate) return

  autoUpdater.autoDownload = true
  // On n'installe jamais pendant que le client tourne : une mise à jour qui
  // relance l'application en plein direct est un incident de diffusion.
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.allowPrerelease = settings.updateChannel === 'beta'

  autoUpdater.on('update-available', (info) =>
    events.onStatus(`Mise à jour ${info.version} en téléchargement.`)
  )
  autoUpdater.on('update-downloaded', (info) =>
    events.onStatus(`Mise à jour ${info.version} prête, appliquée à la fermeture.`)
  )
  autoUpdater.on('error', (error) => events.onStatus(`Mise à jour impossible : ${error.message}`))

  void autoUpdater.checkForUpdates().catch(() => {
    // Pas de réseau ou pas de canal configuré : sans conséquence.
  })
}

interface OverlayManifest {
  version: string
  /** URL de l'archive du bundle. */
  url: string
}

/**
 * Récupère le bundle d'overlay si le serveur en propose un plus récent.
 *
 * Renvoie vrai quand un nouveau bundle a été installé.
 */
export async function syncOverlayBundle(
  currentVersion: string,
  events: UpdaterEvents
): Promise<boolean> {
  const settings = getClientSettings()
  if (!settings.autoUpdateOverlay || !settings.serverUrl) return false

  try {
    const response = await fetch(new URL(API_ROUTES.overlayManifest, settings.serverUrl), {
      signal: AbortSignal.timeout(8000)
    })
    if (!response.ok) return false

    const manifest = (await response.json()) as OverlayManifest
    if (!manifest.version || manifest.version === currentVersion) return false

    const archive = await fetch(new URL(manifest.url, settings.serverUrl), {
      signal: AbortSignal.timeout(60_000)
    })
    if (!archive.ok || !archive.body) return false

    /*
     * On écrit dans un dossier temporaire puis on remplace : interrompre un
     * téléchargement au milieu ne doit jamais laisser un overlay à moitié
     * écrit, qui donnerait un écran blanc dans OBS.
     */
    const target = downloadedOverlayDir()
    const staging = `${target}.staging`
    await rm(staging, { recursive: true, force: true })
    await mkdir(staging, { recursive: true })

    const archivePath = join(staging, 'overlay.zip')
    await pipeline(Readable.fromWeb(archive.body as never), createWriteStream(archivePath))

    // Extraction dans le dossier temporaire, puis bascule atomique.
    const extracted = join(staging, 'bundle')
    new AdmZip(archivePath).extractAllTo(extracted, true)

    if (!existsSync(join(extracted, 'index.html'))) {
      // Archive inattendue : on préfère garder l'overlay livré plutôt que de
      // servir un dossier sans point d'entrée.
      await rm(staging, { recursive: true, force: true })
      events.onStatus("Archive d'overlay invalide, version livrée conservée.")
      return false
    }

    await rm(target, { recursive: true, force: true })
    await rename(extracted, target)
    await rm(staging, { recursive: true, force: true })

    events.onStatus(`Overlay ${manifest.version} installé.`)
    events.onOverlayUpdated()
    return true
  } catch (error) {
    events.onStatus(`Overlay non mis à jour : ${(error as Error).message}`)
    return false
  }
}
