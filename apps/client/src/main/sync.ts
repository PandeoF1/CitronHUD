import { existsSync, statSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import {
  API_KEY_HEADER,
  API_ROUTES,
  CLIENT_VERSION_HEADER,
  clipUploadTicketSchema,
  rosterSnapshotSchema,
  type Player,
  type Team
} from '@citronhud/contracts'
import {
  dropOutbox,
  failOutbox,
  getMeta,
  loadRoster,
  peekOutbox,
  replaceRoster,
  setMeta,
  type ClipUploadJob
} from './db'
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
/**
 * Un clip pèse des dizaines de mégaoctets et monte souvent depuis une connexion
 * qui pousse déjà un direct : les huit secondes des appels d'API n'ont aucun
 * sens ici. Dix minutes laissent passer un gros clip sur un mauvais uplink tout
 * en bornant une montée qui n'aboutira jamais.
 */
const UPLOAD_TIMEOUT_MS = 10 * 60 * 1000

/**
 * Issue d'une entrée de la file.
 *
 * `abandon` est distinct de `retry` : certaines entrées ne peuvent plus aboutir
 * — fichier purgé, clip trop volumineux, téléversement désactivé — et les
 * réessayer dix fois ne fait que retarder le reste de la file.
 */
type OutboxOutcome = 'sent' | 'retry' | 'abandon'

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
   *
   * L'ordre d'insertion est respecté, et ce n'est pas un détail : un clip
   * référence un temps fort que le serveur doit déjà connaître. Les deux
   * entrées partent donc dans le même passage, le temps fort en premier.
   */
  private async flushOutbox(): Promise<void> {
    const rows = peekOutbox()
    if (rows.length === 0) return

    const sent: number[] = []
    const failed: number[] = []

    for (const row of rows) {
      const outcome =
        row.kind === 'clip'
          ? await this.sendClip(JSON.parse(row.payload) as ClipUploadJob)
          : await this.sendMessage(row.kind, row.payload)

      // `abandon` et `sent` mènent au même endroit — retirer l'entrée — mais
      // pour des raisons opposées : l'un a abouti, l'autre n'aboutira jamais.
      // Les compter ensemble éviterait dix tentatives sur un fichier effacé.
      if (outcome === 'retry') failed.push(row.id)
      else sent.push(row.id)
    }

    dropOutbox(sent)
    failOutbox(failed)
  }

  private async sendMessage(kind: string, payload: string): Promise<OutboxOutcome> {
    const path = kind === 'highlight' ? API_ROUTES.highlights : API_ROUTES.recordsSync
    try {
      const response = await this.request(path, { method: 'POST', body: payload })
      // 409 = déjà connu du serveur : l'entrée a bien atteint sa cible.
      return response.ok || response.status === 409 ? 'sent' : 'retry'
    } catch {
      return 'retry'
    }
  }

  /**
   * Téléverse un clip, en trois temps.
   *
   * Le fichier ne passe pas par le serveur applicatif : celui-ci signe une
   * autorisation, la vidéo monte directement vers le stockage objet, puis une
   * confirmation rattache l'URL au temps fort. Sans ce troisième appel le clip
   * existerait dans le stockage sans que rien ne le référence.
   */
  private async sendClip(job: ClipUploadJob): Promise<OutboxOutcome> {
    const settings = getClientSettings()

    /*
     * Le réglage a pu changer depuis la mise en file. Le respecter maintenant
     * plutôt qu'à l'enfilement évite qu'une file constituée avant l'arrêt du
     * téléversement ne parte quand même à la première reconnexion.
     */
    if (!settings.capture.uploadToServer) return 'abandon'

    /*
     * Le fichier a pu être purgé par `pruneClips` avant que le serveur ne
     * redevienne joignable. C'est un cas normal après une longue coupure, pas
     * une erreur : le temps fort reste journalisé, seule la vidéo manque.
     */
    if (!existsSync(job.path)) return 'abandon'
    const sizeBytes = statSync(job.path).size
    if (sizeBytes === 0) return 'abandon'

    const route = API_ROUTES.highlightClip(job.highlightId)

    const ticketResponse = await this.request(route, {
      method: 'POST',
      body: JSON.stringify({
        contentType: 'video/mp4',
        sizeBytes,
        durationMs: job.durationMs
      })
    })

    if (ticketResponse.status === 401 || ticketResponse.status === 403) throw new Error('unauthorized')
    // 413 : ce clip ne passera jamais, quelle que soit la patience.
    if (ticketResponse.status === 413) return 'abandon'
    if (!ticketResponse.ok) return 'retry'

    const ticket = clipUploadTicketSchema.parse(await ticketResponse.json())

    /*
     * Envoi direct au stockage, sans passer par `request` : celui-ci ajoute la
     * clé d'API et `content-type: application/json`, or la signature de l'URL
     * couvre exactement les en-têtes annoncés. Un en-tête de trop et le
     * stockage rejette le PUT.
     */
    const body = await readFile(job.path)
    const upload = await fetch(ticket.uploadUrl, {
      method: 'PUT',
      headers: ticket.headers,
      body: new Uint8Array(body),
      signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS)
    })
    if (!upload.ok) return 'retry'

    const confirm = await this.request(route, {
      method: 'PUT',
      body: JSON.stringify({
        remoteUrl: ticket.publicUrl,
        durationMs: job.durationMs,
        sizeBytes
      })
    })
    return confirm.ok ? 'sent' : 'retry'
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
