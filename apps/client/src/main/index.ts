import { app, BrowserWindow, shell, ipcMain, clipboard, dialog } from 'electron'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { electronApp, is, optimizer } from '@electron-toolkit/utils'
import { CitronEngine } from '@citronhud/gsi'
import type {
  ClientSettings,
  ConnectionStatus,
  Highlight,
  HudConfig,
  HudState,
  Side,
  Slot,
  TeamSlot
} from '@citronhud/contracts'
import { LocalServer } from './server'
import { ObsController } from './obs'
import { CaptureManager } from './capture'
import { SyncService } from './sync'
import { prepareClip, pruneClips } from './clips'
import {
  enqueue,
  closeDb,
  loadRoster,
  loadKnownRecords,
  saveHighlight,
  saveRecord
} from './db'
import { getClientSettings, getHudConfig, updateClientSettings, updateHudConfig } from './settings'
import { getMatch, resetMatch, setSideMode, setTeamSlot, swapTeamSlots, updateMatch } from './match'
import { findSteamPath, installGsiConfig, isGsiInstalled } from './steam'
import { extractRadars } from './radars'
import { radarsDir } from './paths'
import { setupAppUpdater, syncOverlayBundle } from './updater'

/**
 * Orchestrateur du client.
 *
 * Il ne contient aucune logique métier : tout le calcul vit dans
 * `@citronhud/gsi`. Ce fichier ne fait que brancher les morceaux ensemble et
 * décider QUAND les choses arrivent — notamment la seule décision éditoriale du
 * client : à quel moment un replay peut passer à l'antenne.
 */

/*
 * Nom fixé avant toute lecture de chemin.
 *
 * `app.getPath('userData')` le résout à la première invocation et le mémorise.
 * Sans cette ligne, les données non empaquetées atterrissent dans un dossier
 * « Electron » générique, partagé avec toute autre application lancée de la
 * même façon : base et réglages du client s'y mélangeraient.
 */
app.setName('CitronHUD')

/** Sans trame pendant ce délai, on considère CS2 fermé ou en pause. */
const GSI_STALE_MS = 6000

let window: BrowserWindow | null = null
let server: LocalServer
let obs: ObsController
let capture: CaptureManager
let sync: SyncService
let engine: CitronEngine

/** Session de diffusion — regroupe les temps forts dans l'admin. */
const sessionId = randomUUID()

let lastFrameAt = 0
let staleTimer: ReturnType<typeof setInterval> | null = null

/* --------------------------------------------------------------------------
 * État de connexion, poussé au panneau
 * -------------------------------------------------------------------------- */

const status: ConnectionStatus = {
  gsi: 'waiting',
  server: 'local',
  obs: 'disabled',
  overlay: { connected: 0, url: '' },
  capture: 'off',
  lastSyncAt: null,
  lastGsiAt: null,
  gsiRate: null
}

/* --------------------------------------------------------------------------
 * Mesure de la cadence GSI
 * -------------------------------------------------------------------------- */

/**
 * Horodatages des trames récentes, pour une moyenne glissante.
 *
 * Une moyenne plutôt qu'un écart instantané : le débit de CS2 est naturellement
 * irrégulier — il n'émet que sur changement — et un chiffre qui saute entre 8 et
 * 60 n'apprend rien à personne.
 */
const frameTimestamps: number[] = []
/** Fenêtre de moyennage. Assez longue pour être stable, assez courte pour réagir. */
const RATE_WINDOW_MS = 3000
/** La cadence n'est repoussée qu'à cet intervalle : 33 IPC par seconde vers le
 * panneau coûteraient plus cher que ce qu'ils mesurent. */
const RATE_PUSH_INTERVAL_MS = 1000
let lastRatePushAt = 0

function recordFrameRate(now: number): void {
  frameTimestamps.push(now)
  while (frameTimestamps.length > 0 && now - frameTimestamps[0]! > RATE_WINDOW_MS) {
    frameTimestamps.shift()
  }

  if (now - lastRatePushAt < RATE_PUSH_INTERVAL_MS) return
  lastRatePushAt = now

  /*
   * En dessous de quelques échantillons on ne publie rien. C'est le cas au
   * démarrage et à la reprise après une pause, où la fenêtre ne contient qu'une
   * ou deux trames : la division donnerait un chiffre très bas, aussitôt affiché
   * comme « flux irrégulier » alors que le flux vient simplement de reprendre.
   */
  const MINIMUM_SAMPLES = 5
  if (frameTimestamps.length < MINIMUM_SAMPLES) return

  const span = now - frameTimestamps[0]!
  if (span <= 0) return

  const rate = ((frameTimestamps.length - 1) / span) * 1000
  pushStatus({ gsiRate: Math.round(rate * 10) / 10 })
}

function pushStatus(patch: Partial<ConnectionStatus> = {}): void {
  Object.assign(status, patch)
  window?.webContents.send('status', status)
}

/* --------------------------------------------------------------------------
 * Orchestration des replays
 * -------------------------------------------------------------------------- */

/** Empêche deux replays de s'enchaîner et de faire rater la manche suivante. */
let lastReplayAt = 0
let replayInFlight = false
/** Temps forts capturés en attente d'une fenêtre de diffusion. */
const replayQueue: Array<{ highlight: Highlight; clipUrl: string; durationMs: number }> = []

function canPlayNow(state: HudState | null): boolean {
  const config = getHudConfig()
  if (!config.autoPlayReplays || replayInFlight) return false
  if (Date.now() - lastReplayAt < config.replayCooldownMs) return false
  if (!config.replayOnlyBetweenRounds) return true
  // Entre deux manches uniquement : couvrir une manche en cours avec un replay
  // fait manquer l'action en direct, ce qui est pire que de ne rien montrer.
  return state?.phase === 'freezetime' || state?.phase === 'over'
}

function drainReplayQueue(state: HudState | null): void {
  if (replayQueue.length === 0 || !canPlayNow(state)) return
  const next = replayQueue.shift()!
  replayInFlight = true
  lastReplayAt = Date.now()
  server.playReplay(next.highlight, next.clipUrl, next.durationMs)
  server.burstZest('center', 1.4)
}

/**
 * Traite un temps fort détecté : capture, découpe, mise en file.
 *
 * Toujours journalisé même sans capture disponible — les records et
 * l'historique de l'admin ne dépendent pas de la vidéo.
 */
async function handleHighlight(seed: Highlight): Promise<void> {
  server.broadcastHighlight(seed)
  saveHighlight(seed)
  enqueue('highlight', seed)

  const config = getHudConfig()
  if (!config.replayKinds.includes(seed.kind)) return

  const raw = await capture.capture(seed)
  if (!raw) return

  const settings = getClientSettings()
  const clip = await prepareClip(raw.path, seed, settings.capture.trimToWindow)
  if (!clip) return

  // Le clip n'existe qu'après coup : on complète l'entrée déjà journalisée
  // plutôt que d'attendre la vidéo pour écrire quoi que ce soit.
  saveHighlight(seed, clip.path)

  /*
   * Mis en file après le temps fort, jamais avant : le serveur refuse un clip
   * dont il ne connaît pas encore le temps fort. La file étant traitée dans
   * l'ordre d'insertion, les deux partent dans le même passage.
   */
  if (settings.capture.uploadToServer) {
    enqueue('clip', {
      highlightId: seed.id,
      path: clip.path,
      durationMs: clip.durationMs
    })
  }

  /*
   * La purge vient après la mise en file, et c'est volontaire : `keepLocalClips`
   * borne le disque, pas la file d'envoi. Un clip purgé avant d'être monté est
   * abandonné proprement à la synchronisation suivante.
   */
  pruneClips(settings.capture.keepLocalClips)
  replayQueue.push({
    highlight: seed,
    clipUrl: `${server.address}${clip.url}`,
    durationMs: clip.durationMs
  })
}

/* --------------------------------------------------------------------------
 * Boucle GSI
 * -------------------------------------------------------------------------- */

function handleGsiFrame(payload: unknown): void {
  lastFrameAt = Date.now()
  if (status.gsi !== 'live') {
    pushStatus({ gsi: 'live', lastGsiAt: new Date().toISOString() })
  }
  recordFrameRate(lastFrameAt)

  const tick = engine.ingest(payload as never)

  server.broadcastState(tick.state)
  server.broadcastKills(tick.kills)

  for (const record of tick.records) {
    server.broadcastRecord(record)
    saveRecord(record)
    enqueue('record', record)
  }

  /*
   * Les temps forts remontés par le moteur sont des « graines » : il leur
   * manque l'identifiant de session et le clip. On complète ici, où ces
   * informations existent, plutôt que de faire connaître la session au moteur.
   */
  for (const seed of tick.highlights) {
    const highlight = {
      ...seed,
      id: randomUUID(),
      sessionId,
      matchId: getMatch().id,
      occurredAt: new Date().toISOString(),
      clip: {
        status: 'requested',
        source: null,
        localPath: null,
        remoteUrl: null,
        durationMs: null
      }
    } as unknown as Highlight
    void handleHighlight(highlight)
  }

  drainReplayQueue(tick.state)

  // Le panneau affiche les mêmes données que l'overlay : une seule source.
  window?.webContents.send('state', tick.state)
}

/** Bascule en « hors ligne » quand CS2 cesse d'émettre. */
function watchStaleness(): void {
  staleTimer = setInterval(() => {
    if (status.gsi !== 'live') return
    if (Date.now() - lastFrameAt < GSI_STALE_MS) return

    // La cadence est effacée en même temps : afficher « 32 trames/s » sur un
    // flux interrompu donnerait une fausse impression de santé.
    frameTimestamps.length = 0
    pushStatus({ gsi: 'stale', gsiRate: null })
    const stale = engine.markStale()
    if (stale) {
      server.broadcastState(stale)
      window?.webContents.send('state', stale)
    }
  }, 2000)
}

/* --------------------------------------------------------------------------
 * Démarrage
 * -------------------------------------------------------------------------- */

function createWindow(): void {
  window = new BrowserWindow({
    width: 1180,
    height: 780,
    minWidth: 960,
    minHeight: 640,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#12100A',
    title: 'CitronHUD',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  // Affichage différé : une fenêtre qui apparaît blanche puis se peint donne
  // une impression de lenteur au lancement.
  window.on('ready-to-show', () => window?.show())
  window.on('closed', () => {
    window = null
  })

  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  const rendererUrl = process.env.ELECTRON_RENDERER_URL
  if (is.dev && rendererUrl) void window.loadURL(rendererUrl)
  else void window.loadFile(join(__dirname, '../renderer/index.html'))
}

/** Exécute une étape non critique du démarrage sans pouvoir le faire échouer. */
function optional(label: string, step: () => unknown): void {
  try {
    void Promise.resolve(step()).catch((error: unknown) => report(label, error))
  } catch (error) {
    report(label, error)
  }
}

function report(label: string, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error)
  console.error(`[main] ${label} : ${message}`)
  window?.webContents.send('notice', `${label} indisponible : ${message}`)
}

async function bootstrap(): Promise<void> {
  const settings = getClientSettings()
  const config = getHudConfig()

  engine = new CitronEngine(config, getMatch().sides)
  engine.setMatch(getMatch())
  engine.setRoster(loadRoster())
  // Amorçage depuis le cache local : le serveur écrasera ces valeurs à la
  // première synchronisation, mais l'antenne peut commencer avant.
  engine.loadRecords(loadKnownRecords())

  server = new LocalServer({
    onGsiFrame: handleGsiFrame,
    onClientsChanged: ({ overlay }) =>
      pushStatus({ overlay: { connected: overlay, url: server.overlayUrl } }),
    onReplayEnded: () => {
      replayInFlight = false
      server.stopReplay('ended')
    },
    onZestRequested: (origin) => server.burstZest(origin, 1.2),
    gsiRate: () => status.gsiRate
  })

  await server.start(settings.hudPort)
  server.broadcastConfig(config)
  pushStatus({ overlay: { connected: 0, url: server.overlayUrl } })

  obs = new ObsController(settings.obs, {
    onStatus: (state, detail) => {
      pushStatus({ obs: state })
      if (detail) window?.webContents.send('notice', detail)
      if (state === 'connected') void obs.ensureBrowserSource(server.overlayUrl)
      void capture.evaluate()
    },
    onReplaySaved: (path) => capture.handleObsReplaySaved(path)
  })

  capture = new CaptureManager(obs, settings.capture, {
    onModeChanged: (mode) => pushStatus({ capture: mode })
  })

  sync = new SyncService({
    onStatus: (state, detail) => {
      pushStatus({ server: state, lastSyncAt: new Date().toISOString() })
      if (detail && state === 'unauthorized') window?.webContents.send('notice', detail)
    },
    onRosterChanged: (roster) => engine.setRoster(roster)
  })

  sync.primeFromCache()
  sync.start()

  void obs.connect()
  void capture.evaluate()

  /*
   * Ce qui suit est du confort, pas du direct : le HUD est déjà servi et le
   * flux GSI déjà accepté. Un Steam introuvable ou un serveur de mises à jour
   * muet doit se signaler dans le panneau, jamais interrompre le démarrage.
   */
  optional('Installation du GSI', () => {
    if (isGsiInstalled(settings.hudPort, settings.steamPath)) return
    const result = installGsiConfig(settings.hudPort, settings.steamPath)
    updateClientSettings({
      gsiInstalled: result.ok,
      steamPath: settings.steamPath ?? findSteamPath()
    })
    window?.webContents.send('notice', result.message)
  })

  optional('Extraction des radars', () => {
    const result = extractRadars(radarsDir(), { steamPath: settings.steamPath })
    if (result.skipped.length > 0) {
      console.warn('[radars] ignorés :', result.skipped.join(', '))
    }
    // Silencieux quand rien n'a changé : le message n'apprendrait rien.
    if (!result.ok || result.extracted > 0) window?.webContents.send('notice', result.message)
  })

  optional('Mises à jour', () =>
    setupAppUpdater({
      onStatus: (message) => window?.webContents.send('notice', message),
      onOverlayUpdated: () => server.reloadOverlays()
    })
  )

  optional('Bundle overlay', () =>
    syncOverlayBundle(app.getVersion(), {
      onStatus: (message) => window?.webContents.send('notice', message),
      onOverlayUpdated: () => server.reloadOverlays()
    })
  )

  watchStaleness()
}

/* --------------------------------------------------------------------------
 * IPC — le panneau de contrôle
 * -------------------------------------------------------------------------- */

function registerIpc(): void {
  ipcMain.handle('status:get', () => status)
  ipcMain.handle('settings:get', () => getClientSettings())
  ipcMain.handle('config:get', () => getHudConfig())
  ipcMain.handle('match:get', () => getMatch())
  ipcMain.handle('roster:get', () => {
    const { teams, players } = loadRoster()
    return { teams: [...teams.values()], players: [...players.values()] }
  })

  ipcMain.handle('settings:update', async (_event, patch: Partial<ClientSettings>) => {
    const next = updateClientSettings(patch)
    obs.updateSettings(next.obs)
    capture.updateSettings(next.capture)
    if (patch.serverUrl !== undefined || patch.apiKey !== undefined) sync.start()
    return next
  })

  ipcMain.handle('config:update', (_event, patch: Partial<HudConfig>) => {
    const next = updateHudConfig(patch)
    engine.setConfig(next)
    server.broadcastConfig(next)
    return next
  })

  ipcMain.handle('match:setTeam', (_event, slot: Slot, team: TeamSlot) => {
    const next = setTeamSlot(slot, team)
    engine.setMatch(next)
    return next
  })

  ipcMain.handle('match:swapTeams', () => {
    const next = swapTeamSlots()
    engine.setMatch(next)
    return next
  })

  /**
   * Inversion des camps — le bouton de secours.
   *
   * Sert quand des SteamID manquent au roster et que la détection automatique
   * se trompe. Passe en mode manuel : sinon la trame suivante annulerait
   * immédiatement la correction de l'opérateur.
   */
  ipcMain.handle('match:swapSides', () => {
    const sides = engine.swapSides()
    const next = setSideMode('manual', sides.leftSide)
    engine.setMatch(next)
    return next
  })

  ipcMain.handle('match:setSideMode', (_event, mode: 'auto' | 'manual', leftSide?: Side) => {
    engine.setSideMode(mode, leftSide)
    const next = setSideMode(mode, leftSide)
    engine.setMatch(next)
    return next
  })

  ipcMain.handle('match:update', (_event, patch) => {
    const next = updateMatch(patch)
    engine.setMatch(next)
    return next
  })

  ipcMain.handle('match:reset', (_event, keepTeams: boolean) => {
    const next = resetMatch(keepTeams)
    engine.setMatch(next)
    return next
  })

  ipcMain.handle('overlay:url', () => server.overlayUrl)
  ipcMain.handle('overlay:copyUrl', () => {
    clipboard.writeText(server.overlayUrl)
    return server.overlayUrl
  })
  ipcMain.handle('overlay:reload', () => server.reloadOverlays())

  ipcMain.handle('obs:reconnect', async () => {
    await obs.connect()
    return obs.currentStatus
  })
  ipcMain.handle('obs:createSource', async () => {
    await obs.ensureBrowserSource(server.overlayUrl)
    return true
  })

  ipcMain.handle('gsi:install', () => {
    const settings = getClientSettings()
    const result = installGsiConfig(settings.hudPort, settings.steamPath)
    updateClientSettings({ gsiInstalled: result.ok })
    return result
  })

  ipcMain.handle('radars:extract', () => {
    const settings = getClientSettings()
    const result = extractRadars(radarsDir(), { steamPath: settings.steamPath, force: true })
    if (result.ok) server.reloadOverlays()
    return result
  })

  ipcMain.handle('dialog:selectDirectory', async () => {
    const focusedWindow = BrowserWindow.getFocusedWindow() ?? window
    if (!focusedWindow) return null
    const result = await dialog.showOpenDialog(focusedWindow, {
      title: "Sélectionner le dossier d'installation de Steam ou de CS2",
      properties: ['openDirectory']
    })
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  })

  ipcMain.handle('server:test', (_event, url: string, apiKey: string) =>
    sync.testConnection(url, apiKey)
  )
  ipcMain.handle('server:syncNow', async () => {
    await sync.runOnce()
    return status
  })

  ipcMain.handle('zest:burst', (_event, origin: 'left' | 'right' | 'center') => {
    server.burstZest(origin, 1.2)
  })

  /** Coupe un replay en cours — bouton de secours de la régie. */
  ipcMain.handle('replay:cancel', () => {
    replayInFlight = false
    server.stopReplay('cancelled')
  })
}

/* --------------------------------------------------------------------------
 * Cycle de vie
 * -------------------------------------------------------------------------- */

// Une seule instance : deux clients écoutant le même port produiraient un HUD
// qui alterne entre deux états sans que personne ne comprenne pourquoi.
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (!window) return
    if (window.isMinimized()) window.restore()
    window.focus()
  })

  void app.whenReady().then(async () => {
    electronApp.setAppUserModelId('gg.citron.hud')
    app.on('browser-window-created', (_event, created) => optimizer.watchWindowShortcuts(created))

    registerIpc()
    createWindow()

    try {
      await bootstrap()
    } catch (error) {
      console.error('[main] Démarrage incomplet :', error)
      window?.webContents.send('notice', `Démarrage incomplet : ${(error as Error).message}`)
    }

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })

  app.on('before-quit', () => {
    if (staleTimer) clearInterval(staleTimer)
    sync?.stop()
    capture?.dispose()
    void obs?.disconnect()
    void server?.stop()
    closeDb()
  })
}
