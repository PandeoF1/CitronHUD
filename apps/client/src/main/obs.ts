// Import nommé et non par défaut : le paquet est en `type: module` avec une
// carte d'exports qui renvoie vers un bundle CJS sous la condition `require`.
// Le process principal étant émis en CJS, un import par défaut se résout au
// namespace complet du module et non à la classe — d'où un « is not a
// constructor » au démarrage.
import { OBSWebSocket } from 'obs-websocket-js'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir, platform } from 'node:os'
import type { ObsSettings } from '@citronhud/contracts'

/**
 * Pilotage d'OBS.
 *
 * Trois automatismes qui, ensemble, suppriment tout le paramétrage manuel :
 *
 *  1. le mot de passe websocket est LU sur le disque plutôt que demandé ;
 *  2. la source navigateur du HUD est créée et positionnée toute seule ;
 *  3. le tampon de replay est activé et dimensionné.
 *
 * Sans ces trois points, « plug-n-play » signifierait encore : ouvrir les
 * réglages d'OBS, activer le serveur websocket, copier un mot de passe, créer
 * une source, coller une URL, régler une taille, activer un tampon.
 */

export type ObsStatus = 'disabled' | 'connecting' | 'connected' | 'unreachable' | 'auth_failed'

/**
 * Emplacements du fichier de configuration du plugin websocket d'OBS.
 *
 * OBS 28+ intègre obs-websocket et stocke sa configuration en JSON dans le
 * profil global — pas dans le profil de scènes, qui change avec les collections.
 */
function obsConfigPaths(): string[] {
  const home = homedir()
  const relative = join('plugin_config', 'obs-websocket', 'config.json')
  switch (platform()) {
    case 'win32':
      return [join(process.env.APPDATA ?? join(home, 'AppData', 'Roaming'), 'obs-studio', relative)]
    case 'darwin':
      return [join(home, 'Library', 'Application Support', 'obs-studio', relative)]
    default:
      return [
        join(home, '.config', 'obs-studio', relative),
        join(home, '.var', 'app', 'com.obsproject.Studio', 'config', 'obs-studio', relative)
      ]
  }
}

export interface DiscoveredObs {
  password: string
  port: number
  /** Le serveur websocket est activé dans OBS. */
  enabled: boolean
}

/**
 * Lit la configuration websocket d'OBS.
 *
 * On ne force jamais l'activation en modifiant ce fichier : OBS le relit au
 * démarrage seulement, donc l'écrire pendant qu'OBS tourne le ferait écraser
 * sans effet. Quand le serveur est désactivé, on le dit à l'utilisateur.
 */
export function discoverObsCredentials(): DiscoveredObs | null {
  for (const path of obsConfigPaths()) {
    if (!existsSync(path)) continue
    try {
      const raw = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>
      return {
        password: typeof raw.server_password === 'string' ? raw.server_password : '',
        port: typeof raw.server_port === 'number' ? raw.server_port : 4455,
        enabled: raw.server_enabled === true
      }
    } catch {
      // Fichier illisible ou partiellement écrit : on tente l'emplacement suivant.
      continue
    }
  }
  return null
}

export interface ObsControllerEvents {
  onStatus: (status: ObsStatus, detail?: string) => void
  /** OBS a fini d'écrire un clip du tampon de replay. */
  onReplaySaved: (filePath: string) => void
}

export class ObsController {
  private readonly obs = new OBSWebSocket()
  private settings: ObsSettings
  private readonly events: ObsControllerEvents
  private status: ObsStatus = 'disabled'
  private retry: ReturnType<typeof setTimeout> | null = null
  private closing = false

  constructor(settings: ObsSettings, events: ObsControllerEvents) {
    this.settings = settings
    this.events = events

    this.obs.on('ConnectionClosed', () => {
      if (this.closing) return
      this.setStatus('unreachable')
      this.scheduleRetry()
    })

    this.obs.on('ReplayBufferSaved', ({ savedReplayPath }) => {
      this.events.onReplaySaved(savedReplayPath)
    })
  }

  get currentStatus(): ObsStatus {
    return this.status
  }

  private setStatus(status: ObsStatus, detail?: string): void {
    if (this.status === status) return
    this.status = status
    this.events.onStatus(status, detail)
  }

  /**
   * Retente indéfiniment, à cadence fixe.
   *
   * OBS est très souvent lancé APRÈS le client : abandonner après quelques
   * essais obligerait le streamer à redémarrer CitronHUD, ce qui est exactement
   * la friction qu'on cherche à supprimer.
   */
  private scheduleRetry(): void {
    if (this.retry || this.closing || !this.settings.enabled) return
    this.retry = setTimeout(() => {
      this.retry = null
      void this.connect()
    }, 5000)
  }

  async connect(): Promise<void> {
    if (!this.settings.enabled) {
      this.setStatus('disabled')
      return
    }

    // Mot de passe absent : on tente de le lire dans la configuration d'OBS.
    let password = this.settings.password
    let port = this.settings.port
    if (!password) {
      const discovered = discoverObsCredentials()
      if (discovered) {
        password = discovered.password
        port = discovered.port || port
        if (!discovered.enabled) {
          this.setStatus(
            'unreachable',
            "Le serveur websocket d'OBS est désactivé. Activez-le dans Outils › Paramètres du serveur WebSocket."
          )
          this.scheduleRetry()
          return
        }
      }
    }

    this.setStatus('connecting')
    try {
      await this.obs.connect(`ws://${this.settings.host}:${port}`, password || undefined, {
        rpcVersion: 1
      })
      this.setStatus('connected')
      await this.applyAutomation()
    } catch (error) {
      const message = (error as Error).message ?? ''
      // Distinguer « mauvais mot de passe » de « OBS éteint » : la conduite à
      // tenir n'est pas la même, et un message générique ne guide personne.
      const authFailure = /authentication|password/i.test(message)
      this.setStatus(authFailure ? 'auth_failed' : 'unreachable', message)
      if (!authFailure) this.scheduleRetry()
    }
  }

  /** Applique les automatismes une fois la connexion établie. */
  private async applyAutomation(): Promise<void> {
    if (this.settings.manageReplayBuffer) await this.ensureReplayBuffer()
  }

  /**
   * Crée ou met à jour la source navigateur du HUD dans la scène courante.
   *
   * Idempotent : relancer le client ne duplique pas la source, il met à jour
   * son URL — utile quand le port local change.
   */
  async ensureBrowserSource(overlayUrl: string): Promise<void> {
    if (!this.settings.manageBrowserSource || this.status !== 'connected') return

    const name = this.settings.browserSourceName
    const inputSettings = { url: overlayUrl, width: 1920, height: 1080, reroute_audio: false }

    try {
      await this.obs.call('SetInputSettings', { inputName: name, inputSettings, overlay: true })
      return
    } catch {
      // La source n'existe pas encore : on la crée dans la scène active.
    }

    try {
      const { currentProgramSceneName } = await this.obs.call('GetCurrentProgramScene')
      await this.obs.call('CreateInput', {
        sceneName: currentProgramSceneName,
        inputName: name,
        inputKind: 'browser_source',
        inputSettings
      })
    } catch (error) {
      this.setStatus('connected', `Création de la source impossible : ${(error as Error).message}`)
    }
  }

  /** Active le tampon de replay et vérifie sa durée. */
  private async ensureReplayBuffer(): Promise<void> {
    try {
      const { outputActive } = await this.obs.call('GetReplayBufferStatus')
      if (!outputActive) await this.obs.call('StartReplayBuffer')
    } catch (error) {
      this.setStatus(
        'connected',
        `Tampon de replay indisponible : ${(error as Error).message}. Vérifiez qu'il est activé dans Paramètres › Sortie.`
      )
    }
  }

  /**
   * Demande la sauvegarde du tampon.
   *
   * Le fichier n'est pas écrit immédiatement : OBS répond tout de suite puis
   * émet `ReplayBufferSaved` avec le chemin réel. C'est cet évènement qui fait
   * foi, pas le retour de l'appel.
   */
  async saveReplayBuffer(): Promise<boolean> {
    if (this.status !== 'connected') return false
    try {
      await this.obs.call('SaveReplayBuffer')
      return true
    } catch {
      return false
    }
  }

  updateSettings(settings: ObsSettings): void {
    const needsReconnect =
      settings.host !== this.settings.host ||
      settings.port !== this.settings.port ||
      settings.password !== this.settings.password ||
      settings.enabled !== this.settings.enabled
    this.settings = settings
    if (needsReconnect) void this.reconnect()
  }

  private async reconnect(): Promise<void> {
    await this.disconnect()
    this.closing = false
    await this.connect()
  }

  async disconnect(): Promise<void> {
    this.closing = true
    if (this.retry) {
      clearTimeout(this.retry)
      this.retry = null
    }
    try {
      await this.obs.disconnect()
    } catch {
      // Déjà fermé — rien à signaler.
    }
    this.setStatus('disabled')
  }
}
