import { contextBridge, ipcRenderer } from 'electron'
import type {
  ClientSettings,
  ConnectionStatus,
  HudConfig,
  HudState,
  MatchSetup,
  Player,
  Side,
  Slot,
  Team,
  TeamSlot
} from '@citronhud/contracts'

/**
 * Pont entre le panneau et le process principal.
 *
 * Surface explicite et étroite : on n'expose jamais `ipcRenderer` brut. Le
 * renderer charge des avatars distants, donc il doit être traité comme un
 * contexte à privilèges réduits.
 */

const api = {
  getStatus: (): Promise<ConnectionStatus> => ipcRenderer.invoke('status:get'),
  getSettings: (): Promise<ClientSettings> => ipcRenderer.invoke('settings:get'),
  getConfig: (): Promise<HudConfig> => ipcRenderer.invoke('config:get'),
  getMatch: (): Promise<MatchSetup> => ipcRenderer.invoke('match:get'),
  getRoster: (): Promise<{ teams: Team[]; players: Player[] }> => ipcRenderer.invoke('roster:get'),

  updateSettings: (patch: Partial<ClientSettings>): Promise<ClientSettings> =>
    ipcRenderer.invoke('settings:update', patch),
  updateConfig: (patch: Partial<HudConfig>): Promise<HudConfig> =>
    ipcRenderer.invoke('config:update', patch),

  setTeam: (slot: Slot, team: TeamSlot): Promise<MatchSetup> =>
    ipcRenderer.invoke('match:setTeam', slot, team),
  swapTeams: (): Promise<MatchSetup> => ipcRenderer.invoke('match:swapTeams'),
  swapSides: (): Promise<MatchSetup> => ipcRenderer.invoke('match:swapSides'),
  setSideMode: (mode: 'auto' | 'manual', leftSide?: Side): Promise<MatchSetup> =>
    ipcRenderer.invoke('match:setSideMode', mode, leftSide),
  updateMatch: (patch: Partial<MatchSetup>): Promise<MatchSetup> =>
    ipcRenderer.invoke('match:update', patch),
  resetMatch: (keepTeams: boolean): Promise<MatchSetup> =>
    ipcRenderer.invoke('match:reset', keepTeams),

  getOverlayUrl: (): Promise<string> => ipcRenderer.invoke('overlay:url'),
  copyOverlayUrl: (): Promise<string> => ipcRenderer.invoke('overlay:copyUrl'),
  reloadOverlay: (): Promise<void> => ipcRenderer.invoke('overlay:reload'),

  reconnectObs: (): Promise<string> => ipcRenderer.invoke('obs:reconnect'),
  createObsSource: (): Promise<boolean> => ipcRenderer.invoke('obs:createSource'),

  installGsi: (): Promise<{ ok: boolean; path: string | null; message: string }> =>
    ipcRenderer.invoke('gsi:install'),
  selectDirectory: (): Promise<string | null> => ipcRenderer.invoke('dialog:selectDirectory'),

  testServer: (url: string, apiKey: string): Promise<{ ok: boolean; message: string }> =>
    ipcRenderer.invoke('server:test', url, apiKey),
  syncNow: (): Promise<ConnectionStatus> => ipcRenderer.invoke('server:syncNow'),

  burstZest: (origin: 'left' | 'right' | 'center'): Promise<void> =>
    ipcRenderer.invoke('zest:burst', origin),
  cancelReplay: (): Promise<void> => ipcRenderer.invoke('replay:cancel'),

  /* ---- Flux poussés par le process principal ---- */

  onStatus: (handler: (status: ConnectionStatus) => void): (() => void) => {
    const listener = (_event: unknown, value: ConnectionStatus): void => handler(value)
    ipcRenderer.on('status', listener)
    return () => ipcRenderer.off('status', listener)
  },
  onState: (handler: (state: HudState) => void): (() => void) => {
    const listener = (_event: unknown, value: HudState): void => handler(value)
    ipcRenderer.on('state', listener)
    return () => ipcRenderer.off('state', listener)
  },
  /** Messages de diagnostic destinés à l'opérateur. */
  onNotice: (handler: (message: string) => void): (() => void) => {
    const listener = (_event: unknown, value: string): void => handler(value)
    ipcRenderer.on('notice', listener)
    return () => ipcRenderer.off('notice', listener)
  }
}

export type CitronApi = typeof api

/**
 * Pont de la fenêtre d'enregistrement.
 *
 * Exposé sur le même preload parce que les deux fenêtres le partagent, mais
 * sous une clé distincte : le panneau n'a aucune raison d'accéder au tampon de
 * capture, et l'enregistreur aucune raison de piloter le match.
 */
const recorder = {
  onStart: (
    handler: (options: {
      sourceId: string
      bufferSeconds: number
      fps: number
      height: number
    }) => void
  ): void => {
    ipcRenderer.on('recorder:start', (_event, options) => handler(options))
  },
  onFlush: (handler: () => void): void => {
    ipcRenderer.on('recorder:flush', () => handler())
  },
  onStop: (handler: () => void): void => {
    ipcRenderer.on('recorder:stop', () => handler())
  },
  /** Renvoie le tampon au process principal ; `null` en cas d'échec. */
  sendChunk: (data: ArrayBuffer | null): void => {
    ipcRenderer.send('recorder:chunk', data)
  }
}

export type CitronRecorder = typeof recorder

contextBridge.exposeInMainWorld('citron', api)
contextBridge.exposeInMainWorld('citronRecorder', recorder)
