import { BrowserWindow, ipcMain, desktopCapturer } from 'electron'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { is } from '@electron-toolkit/utils'
import type { CaptureSettings, Highlight } from '@citronhud/contracts'
import { CAPTURE_WINDOW } from '@citronhud/contracts'
import { captureDir } from './paths'
import type { ObsController } from './obs'

/**
 * Capture des temps forts — deux chemins, une seule interface.
 *
 *  - `obs`      : le tampon de replay d'OBS. Qualité identique au direct,
 *                 coût nul tant qu'aucun temps fort ne survient ;
 *  - `internal` : un tampon circulaire tenu par le client. Fonctionne sans OBS
 *                 mais consomme du CPU en permanence.
 *
 * En mode `auto`, OBS gagne dès qu'il répond. Le repli n'est armé que si OBS
 * est injoignable : faire tourner les deux en parallèle doublerait la charge
 * pour un seul clip utile.
 */

export type CaptureMode = 'off' | 'obs' | 'internal' | 'unavailable'

export interface CaptureEvents {
  onModeChanged: (mode: CaptureMode) => void
}

/** Un clip brut, avant découpe. */
export interface RawCapture {
  path: string
}

/* --------------------------------------------------------------------------
 * Tampon interne
 * -------------------------------------------------------------------------- */

const RECORDER_CHANNEL = {
  start: 'recorder:start',
  stop: 'recorder:stop',
  flush: 'recorder:flush',
  chunk: 'recorder:chunk'
} as const

/**
 * Enregistreur interne.
 *
 * MediaRecorder n'existe que dans un contexte navigateur : on héberge donc le
 * tampon dans une fenêtre cachée plutôt que dans le process principal. Elle
 * n'affiche rien et ne coûte qu'un onglet inactif.
 */
class InternalRecorder {
  private window: BrowserWindow | null = null
  private pending: ((buffer: Buffer | null) => void) | null = null

  constructor() {
    ipcMain.on(RECORDER_CHANNEL.chunk, (_event, data: ArrayBuffer | null) => {
      const resolve = this.pending
      this.pending = null
      resolve?.(data ? Buffer.from(data) : null)
    })
  }

  async start(settings: CaptureSettings): Promise<boolean> {
    if (this.window) return true

    // On capture l'écran entier : cibler la fenêtre de CS2 échoue dès que le
    // jeu tourne en plein écran exclusif, ce qui est le cas le plus courant.
    const sources = await desktopCapturer.getSources({ types: ['screen'] })
    const screen = sources[0]
    if (!screen) return false

    this.window = new BrowserWindow({
      show: false,
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        // La capture d'écran exige l'accès aux API média du renderer.
        sandbox: false,
        backgroundThrottling: false
      }
    })

    const url =
      is.dev && process.env.ELECTRON_RENDERER_URL
        ? `${process.env.ELECTRON_RENDERER_URL}/recorder.html`
        : join(__dirname, '../renderer/recorder.html')

    if (url.startsWith('http')) await this.window.loadURL(url)
    else await this.window.loadFile(url)

    this.window.webContents.send(RECORDER_CHANNEL.start, {
      sourceId: screen.id,
      bufferSeconds: settings.internalBufferSeconds,
      fps: settings.internalFps,
      height: settings.internalHeight
    })
    return true
  }

  /** Réclame le contenu du tampon et l'écrit sur disque. */
  async flush(name: string): Promise<string | null> {
    if (!this.window) return null

    const buffer = await new Promise<Buffer | null>((resolve) => {
      // Garde-fou : si la fenêtre ne répond pas, on ne bloque pas la chaîne de
      // replay — un temps fort manqué vaut mieux qu'un client figé.
      const timeout = setTimeout(() => {
        this.pending = null
        resolve(null)
      }, 6000)

      this.pending = (value) => {
        clearTimeout(timeout)
        resolve(value)
      }
      this.window!.webContents.send(RECORDER_CHANNEL.flush)
    })

    if (!buffer) return null
    const target = join(captureDir(), `${name}.webm`)
    await writeFile(target, buffer)
    return target
  }

  stop(): void {
    if (!this.window) return
    this.window.webContents.send(RECORDER_CHANNEL.stop)
    this.window.destroy()
    this.window = null
  }
}

/* --------------------------------------------------------------------------
 * Gestionnaire
 * -------------------------------------------------------------------------- */

export class CaptureManager {
  private readonly obs: ObsController
  private readonly events: CaptureEvents
  private readonly internal = new InternalRecorder()
  private settings: CaptureSettings
  private mode: CaptureMode = 'off'

  /** Résout la promesse du clip OBS en cours d'écriture. */
  private awaitingObsClip: ((path: string | null) => void) | null = null

  constructor(obs: ObsController, settings: CaptureSettings, events: CaptureEvents) {
    this.obs = obs
    this.settings = settings
    this.events = events
  }

  get currentMode(): CaptureMode {
    return this.mode
  }

  /** Appelé par le contrôleur OBS quand un fichier de tampon est écrit. */
  handleObsReplaySaved(path: string): void {
    const resolve = this.awaitingObsClip
    this.awaitingObsClip = null
    resolve?.(path)
  }

  private setMode(mode: CaptureMode): void {
    if (this.mode === mode) return
    this.mode = mode
    this.events.onModeChanged(mode)
  }

  /**
   * Choisit le chemin de capture selon l'état réel d'OBS.
   *
   * Réévalué à chaque changement de statut : OBS lancé après le client doit
   * reprendre la main sur le repli interne, sans redémarrage.
   */
  async evaluate(): Promise<void> {
    if (this.settings.mode === 'off') {
      this.internal.stop()
      this.setMode('off')
      return
    }

    const obsReady = this.obs.currentStatus === 'connected'

    if (this.settings.mode === 'obs') {
      this.internal.stop()
      this.setMode(obsReady ? 'obs' : 'unavailable')
      return
    }

    if (this.settings.mode === 'internal' || !obsReady) {
      const started = await this.internal.start(this.settings)
      this.setMode(started ? 'internal' : 'unavailable')
      return
    }

    // Mode auto avec OBS disponible : le repli interne est inutile.
    this.internal.stop()
    this.setMode('obs')
  }

  /**
   * Capture un temps fort.
   *
   * Renvoie le chemin du fichier BRUT ; la découpe est faite ensuite par
   * `clips.ts`. Séparer les deux permet de garder l'original si la découpe
   * échoue.
   */
  async capture(highlight: Highlight): Promise<RawCapture | null> {
    if (this.mode === 'obs') {
      const path = await this.captureFromObs()
      return path ? { path } : null
    }
    if (this.mode === 'internal') {
      const path = await this.internal.flush(highlight.id)
      return path ? { path } : null
    }
    return null
  }

  /**
   * Déclenche la sauvegarde du tampon d'OBS et attend le fichier.
   *
   * OBS répond à l'appel avant d'avoir écrit quoi que ce soit : c'est
   * l'évènement `ReplayBufferSaved` qui porte le chemin réel.
   */
  private captureFromObs(): Promise<string | null> {
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        this.awaitingObsClip = null
        resolve(null)
      }, 12_000)

      this.awaitingObsClip = (path) => {
        clearTimeout(timeout)
        resolve(path)
      }

      void this.obs.saveReplayBuffer().then((accepted) => {
        if (accepted) return
        clearTimeout(timeout)
        this.awaitingObsClip = null
        resolve(null)
      })
    })
  }

  /** Durée totale à conserver pour un type de temps fort donné. */
  static windowMs(highlight: Highlight): number {
    const window = CAPTURE_WINDOW[highlight.kind]
    return window.preRollMs + window.postRollMs
  }

  updateSettings(settings: CaptureSettings): void {
    this.settings = settings
    void this.evaluate()
  }

  dispose(): void {
    this.internal.stop()
  }
}
