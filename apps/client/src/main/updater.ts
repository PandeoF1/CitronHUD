import { app } from 'electron'
import { updateElectronApp } from 'update-electron-app'
import AdmZip from 'adm-zip'
import { createWriteStream, existsSync } from 'node:fs'
import { rm, mkdir, rename, readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { join } from 'node:path'
import { API_KEY_HEADER, API_ROUTES, overlayManifestSchema } from '@citronhud/contracts'
import { downloadedOverlayDir } from './paths'
import { getClientSettings } from './settings'

/**
 * Mises à jour — à deux vitesses.
 *
 * L'application elle-même passe par `update-electron-app` (GitHub Releases), ce
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
   * canal de publication : sortir avant de configurer l'updater évite de faire
   * échouer tout le démarrage pour une fonctionnalité qui n'a de sens qu'en production.
   */
  if (!app.isPackaged) return

  const settings = getClientSettings()
  if (!settings.autoUpdate) return

  updateElectronApp({
    repo: 'PandeoF1/CitronHUD',
    updateInterval: '10 minutes',
    logger: {
      log: (msg: string) => events.onStatus(msg),
      info: (msg: string) => events.onStatus(msg),
      warn: (msg: string) => events.onStatus(msg),
      error: (msg: string) => events.onStatus(`Mise à jour impossible : ${msg}`)
    }
  })
}

/**
 * Compare deux versions « x.y.z ».
 *
 * Négatif si `a` précède `b`. Une comparaison de chaînes ne suffirait pas :
 * `'0.10.0' < '0.9.0'` est vrai en ordre lexicographique, ce qui bloquerait
 * précisément les clients les plus récents.
 */
function compareVersions(a: string, b: string): number {
  const left = a.split('.').map((part) => Number.parseInt(part, 10) || 0)
  const right = b.split('.').map((part) => Number.parseInt(part, 10) || 0)
  for (let i = 0; i < Math.max(left.length, right.length); i += 1) {
    const diff = (left[i] ?? 0) - (right[i] ?? 0)
    if (diff !== 0) return diff
  }
  return 0
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
    /*
     * Le manifeste est derrière l'authentification comme le reste de l'API :
     * sans la clé, le serveur répond 401 et la mise à jour de l'overlay échoue
     * en silence — le pire des cas, puisque rien ne le signale.
     */
    const response = await fetch(new URL(API_ROUTES.overlayManifest, settings.serverUrl), {
      headers: settings.apiKey ? { [API_KEY_HEADER]: settings.apiKey } : {},
      signal: AbortSignal.timeout(8000)
    })
    // 404 est une réponse normale : aucune version publiée.
    if (!response.ok) return false

    const parsed = overlayManifestSchema.safeParse(await response.json())
    if (!parsed.success) return false
    const manifest = parsed.data

    if (manifest.version === currentVersion) return false

    /*
     * Un bundle peut réclamer une nouveauté du client — un évènement socket
     * inédit, par exemple. L'installer sur une version trop ancienne donnerait
     * un HUD cassé à l'antenne, alors que le refuser ne coûte qu'une apparence
     * datée.
     */
    if (compareVersions(app.getVersion(), manifest.minClientVersion) < 0) {
      events.onStatus(
        `Overlay ${manifest.version} ignoré : il demande un client ${manifest.minClientVersion} ou plus récent.`
      )
      return false
    }

    // L'archive est servie par le stockage objet, en accès public : c'est la
    // seule requête de la chaîne qui ne porte pas la clé.
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

    /*
     * Empreinte vérifiée avant d'extraire quoi que ce soit. Le contrat l'annonce
     * et ce n'est pas décoratif : ce fichier est téléchargé automatiquement puis
     * exécuté dans la source navigateur d'OBS, en direct. Un téléchargement
     * tronqué ou une archive substituée dans le stockage ne doit jamais aller
     * plus loin que ce test.
     */
    const digest = createHash('sha256').update(await readFile(archivePath)).digest('hex')
    if (digest !== manifest.sha256) {
      await rm(staging, { recursive: true, force: true })
      events.onStatus("Empreinte de l'overlay incorrecte, version livrée conservée.")
      return false
    }

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
