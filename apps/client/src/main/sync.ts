import {
  API_KEY_HEADER,
  API_ROUTES,
  CLIENT_VERSION_HEADER,
  rosterSnapshotSchema,
  type Player,
  type Team
} from '@citronhud/contracts'
import { dropOutbox, failOutbox, getMeta, loadRoster, peekOutbox, replaceRoster, setMeta } from './db'
import { getClientSettings } from './settings'

/**
 * Synchronisation avec le serveur.
 *
 * Toujours en arrière-plan, jamais dans le chemin de rendu. Le moteur lit le
 * cache SQLite ; cette classe ne fait que le rafraîchir. Un serveur lent ou
 * absent n'a donc aucun effet sur ce qui passe à l'antenne.
 */

export type ServerStatus = 'local' | 'online' | 'offline' | 'unauthorized' | 'syncing'

export interface SyncEvents {
  onStatus: (status: ServerStatus, detail?: string) => void
  /** Le roster local a changé : le moteur doit le recharger. */
  onRosterChanged: (roster: { teams: Map<string, Team>; players: Map<string, Player> }) => void
}

const ROSTER_VERSION_KEY = 'roster:version'
/** Au-delà, on considère le serveur injoignable plutôt que lent. */
const REQUEST_TIMEOUT_MS = 8000

export class SyncService {
  private readonly events: SyncEvents
  private timer: ReturnType<typeof setInterval> | null = null
  private running = false

  constructor(events: SyncEvents) {
    this.events = events
  }

  /** Charge le cache local immédiatement, sans attendre le réseau. */
  primeFromCache(): void {
    this.events.onRosterChanged(loadRoster())
  }

  start(): void {
    this.stop()
    const settings = getClientSettings()

    if (!settings.serverUrl) {
      // Aucun serveur configuré : ce n'est pas une panne, c'est un mode.
      this.events.onStatus('local')
      return
    }

    void this.runOnce()
    this.timer = setInterval(() => void this.runOnce(), settings.syncIntervalMs)
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  private headers(): Record<string, string> {
    const settings = getClientSettings()
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      [CLIENT_VERSION_HEADER]: process.env.npm_package_version ?? '0.1.0'
    }
    if (settings.apiKey) headers[API_KEY_HEADER] = settings.apiKey
    return headers
  }

  private async request(path: string, init?: RequestInit): Promise<Response> {
    const { serverUrl } = getClientSettings()
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
    try {
      return await fetch(new URL(path, serverUrl), {
        ...init,
        headers: { ...this.headers(), ...(init?.headers as Record<string, string>) },
        signal: controller.signal
      })
    } finally {
      clearTimeout(timeout)
    }
  }

  /** Un passage complet : roster descendant, puis file d'envoi montante. */
  async runOnce(): Promise<void> {
    if (this.running) return
    const settings = getClientSettings()
    if (!settings.serverUrl) {
      this.events.onStatus('local')
      return
    }

    this.running = true
    this.events.onStatus('syncing')
    try {
      await this.pullRoster()
      await this.flushOutbox()
      this.events.onStatus('online')
      setMeta('sync:lastAt', new Date().toISOString())
    } catch (error) {
      const message = (error as Error).message
      if (message === 'unauthorized') {
        this.events.onStatus('unauthorized', "Clé d'API refusée par le serveur.")
      } else {
        // Hors ligne n'est pas une erreur à afficher en rouge : le client
        // continue de fonctionner sur son cache, c'est le comportement prévu.
        this.events.onStatus('offline', message)
      }
    } finally {
      this.running = false
    }
  }

  /**
   * Récupère le roster.
   *
   * On envoie la version connue ; le serveur répond 304 si rien n'a changé.
   * Sur un roster de plusieurs centaines de joueurs avec avatars, cela évite de
   * retransférer le même contenu toutes les cinq minutes.
   */
  private async pullRoster(): Promise<void> {
    const known = getMeta(ROSTER_VERSION_KEY)
    const query = known ? `?version=${encodeURIComponent(known)}` : ''
    const response = await this.request(`${API_ROUTES.roster}${query}`)

    if (response.status === 304) return
    if (response.status === 401 || response.status === 403) throw new Error('unauthorized')
    if (!response.ok) throw new Error(`Réponse ${response.status} du serveur`)

    const snapshot = rosterSnapshotSchema.parse(await response.json())
    replaceRoster(snapshot.teams, snapshot.players)
    setMeta(ROSTER_VERSION_KEY, snapshot.version)
    this.events.onRosterChanged(loadRoster())
  }

  /**
   * Vide la file d'envoi.
   *
   * Traitée entrée par entrée : un temps fort refusé ne doit pas empêcher les
   * suivants de partir. Les échecs sont comptés et abandonnés après dix essais.
   */
  private async flushOutbox(): Promise<void> {
    const rows = peekOutbox()
    if (rows.length === 0) return

    const sent: number[] = []
    const failed: number[] = []

    for (const row of rows) {
      const path = row.kind === 'highlight' ? API_ROUTES.highlights : API_ROUTES.recordsSync
      try {
        const response = await this.request(path, { method: 'POST', body: row.payload })
        if (response.ok || response.status === 409) {
          // 409 = déjà connu du serveur : l'entrée a bien atteint sa cible.
          sent.push(row.id)
        } else {
          failed.push(row.id)
        }
      } catch {
        failed.push(row.id)
      }
    }

    dropOutbox(sent)
    failOutbox(failed)
  }

  /** Teste la liaison sans rien modifier — bouton « Tester » du panneau. */
  async testConnection(url: string, apiKey: string): Promise<{ ok: boolean; message: string }> {
    if (!url) return { ok: true, message: 'Mode local : aucun serveur utilisé.' }
    try {
      const response = await fetch(new URL(API_ROUTES.health, url), {
        headers: apiKey ? { [API_KEY_HEADER]: apiKey } : {},
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
      })
      if (response.status === 401 || response.status === 403) {
        return { ok: false, message: "Serveur joignable, mais la clé d'API est refusée." }
      }
      if (!response.ok) return { ok: false, message: `Le serveur a répondu ${response.status}.` }
      return { ok: true, message: 'Serveur joignable.' }
    } catch (error) {
      return { ok: false, message: `Injoignable : ${(error as Error).message}` }
    }
  }
}
