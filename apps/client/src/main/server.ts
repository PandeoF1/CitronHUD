import express from 'express'
import cors from 'cors'
import { createServer, type Server as HttpServer } from 'node:http'
import { Server as SocketServer } from 'socket.io'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type {
  ClientToServerEvents,
  Highlight,
  HudConfig,
  HudState,
  InterServerEvents,
  KillEvent,
  RecordBroken,
  ServerToClientEvents,
  SocketData
} from '@citronhud/contracts'
import { SOCKET_ROOM } from '@citronhud/contracts'
import { activeOverlayDir, clipsDir, radarsDir } from './paths'

/**
 * Le serveur local.
 *
 * Un seul port sert TOUT : l'overlay, les clips, le websocket et l'endpoint
 * GSI. C'est délibéré — JT's HUD en utilise deux, ce qui double les pare-feux à
 * autoriser et les ports à expliquer. Un port, une URL, un seul réglage.
 *
 * Il écoute sur 127.0.0.1 par défaut. Passer en 0.0.0.0 n'est utile qu'en régie
 * séparée (OBS sur une autre machine) et reste un choix explicite : exposer un
 * serveur sur le réseau local doit être décidé, pas subi.
 */

export interface LocalServerEvents {
  /** Une trame GSI brute est arrivée de CS2. */
  onGsiFrame: (payload: unknown) => void
  /** Un overlay ou un panneau s'est (dé)connecté. */
  onClientsChanged: (counts: { overlay: number; control: number }) => void
  /** L'overlay signale la fin d'un replay. */
  onReplayEnded: (highlightId: string) => void
  /** Le panneau demande une gerbe de zestes. */
  onZestRequested: (origin: 'left' | 'right' | 'center') => void
}

type Io = SocketServer<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>

export class LocalServer {
  private http: HttpServer | null = null
  private io: Io | null = null
  private port = 0
  private readonly events: LocalServerEvents

  /**
   * Dernier état connu.
   *
   * Renvoyé immédiatement à tout overlay qui se connecte : une source
   * navigateur rechargée en plein match doit retrouver le HUD peuplé sans
   * attendre la trame suivante.
   */
  private lastState: HudState | null = null
  private lastConfig: HudConfig | null = null

  constructor(events: LocalServerEvents) {
    this.events = events
  }

  get address(): string {
    return `http://127.0.0.1:${this.port}`
  }

  get overlayUrl(): string {
    return `${this.address}/overlay/`
  }

  async start(port: number, host = '127.0.0.1'): Promise<void> {
    await this.stop()

    const app = express()
    // Les sources navigateur d'OBS envoient une origine `null` ou `file://`.
    app.use(cors({ origin: '*' }))
    // Les trames GSI de CS2 dépassent facilement la limite par défaut de 100 ko
    // quand les dix joueurs portent positions, armes et statistiques.
    app.use(express.json({ limit: '2mb' }))

    /*
     * Endpoint GSI.
     *
     * CS2 doit recevoir un 200 rapidement : toute lenteur ici fait ralentir le
     * moteur d'envoi du jeu. On répond donc AVANT de traiter la trame.
     */
    app.post('/gsi', (req, res) => {
      res.status(200).end()
      try {
        this.events.onGsiFrame(req.body)
      } catch (error) {
        console.error('[gsi] Trame ignorée :', error)
      }
    })

    // L'overlay servi à OBS.
    app.use('/overlay', express.static(activeOverlayDir(), { fallthrough: true }))
    // Les images de radar, chargées par l'overlay en chemin relatif.
    app.use('/overlay/radars', express.static(radarsDir()))
    // Les clips de replay.
    app.use('/clips', express.static(clipsDir(), { maxAge: '1h' }))

    /*
     * Sonde de vie.
     *
     * Utilisée par le panneau et par un éventuel script de régie pour savoir si
     * le client tourne, sans ouvrir de websocket.
     */
    app.get('/health', (_req, res) => {
      res.json({
        ok: true,
        overlayUrl: this.overlayUrl,
        live: this.lastState?.live ?? false,
        overlays: this.io?.sockets.adapter.rooms.get(SOCKET_ROOM.overlay)?.size ?? 0
      })
    })

    // Une source navigateur mal configurée doit dire pourquoi, pas renvoyer 404.
    app.use('/overlay', (_req, res) => {
      const index = join(activeOverlayDir(), 'index.html')
      if (existsSync(index)) return res.sendFile(index)
      res
        .status(503)
        .type('text/plain')
        .send("Bundle de l'overlay introuvable. Réinstallez le client CitronHUD.")
    })

    this.http = createServer(app)
    this.io = new SocketServer(this.http, {
      cors: { origin: '*' },
      // Les sources navigateur d'OBS gèrent le websocket nativement ; se
      // priver du polling évite une montée en charge inutile au démarrage.
      transports: ['websocket']
    })

    this.io.on('connection', (socket) => {
      socket.on('hello', ({ role, version }) => {
        socket.data.role = role
        socket.data.version = version
        void socket.join(role === 'overlay' ? SOCKET_ROOM.overlay : SOCKET_ROOM.control)

        // Rattrapage immédiat : l'arrivant reçoit l'état courant sans attendre.
        if (this.lastConfig) socket.emit('config', this.lastConfig)
        if (this.lastState) socket.emit('state', this.lastState)

        this.emitCounts()
      })

      socket.on('replay:ended', ({ highlightId }) => this.events.onReplayEnded(highlightId))
      socket.on('zest:trigger', ({ origin }) => this.events.onZestRequested(origin))
      socket.on('disconnect', () => this.emitCounts())
    })

    await new Promise<void>((resolve, reject) => {
      this.http!.once('error', reject)
      this.http!.listen(port, host, () => {
        this.port = port
        this.http!.removeListener('error', reject)
        resolve()
      })
    })

    console.log(`[server] CitronHUD écoute sur ${this.address}`)
  }

  private emitCounts(): void {
    const rooms = this.io?.sockets.adapter.rooms
    this.events.onClientsChanged({
      overlay: rooms?.get(SOCKET_ROOM.overlay)?.size ?? 0,
      control: rooms?.get(SOCKET_ROOM.control)?.size ?? 0
    })
  }

  /** Diffuse l'état complet. Mémorisé pour les connexions suivantes. */
  broadcastState(state: HudState): void {
    this.lastState = state
    this.io?.emit('state', state)
  }

  broadcastConfig(config: HudConfig): void {
    this.lastConfig = config
    this.io?.emit('config', config)
  }

  /** Les kills partent séparément : ce sont des évènements, pas de l'état. */
  broadcastKills(kills: KillEvent[]): void {
    if (kills.length === 0) return
    this.io?.emit('kills', kills)
  }

  broadcastHighlight(highlight: Highlight): void {
    this.io?.emit('highlight', highlight)
  }

  playReplay(highlight: Highlight, clipUrl: string, durationMs: number): void {
    this.io?.to(SOCKET_ROOM.overlay).emit('replay:play', { highlight, clipUrl, durationMs })
  }

  stopReplay(reason: 'ended' | 'cancelled' | 'error'): void {
    this.io?.to(SOCKET_ROOM.overlay).emit('replay:stop', { reason })
  }

  broadcastRecord(record: RecordBroken): void {
    this.io?.emit('record:broken', record)
  }

  burstZest(origin: 'left' | 'right' | 'center', intensity = 1): void {
    this.io?.to(SOCKET_ROOM.overlay).emit('zest:burst', { origin, intensity })
  }

  /** Recharge les overlays — après mise à jour du bundle. */
  reloadOverlays(): void {
    this.io?.to(SOCKET_ROOM.overlay).emit('reload')
  }

  async stop(): Promise<void> {
    if (this.io) {
      await new Promise<void>((resolve) => this.io!.close(() => resolve()))
      this.io = null
    }
    if (this.http) {
      await new Promise<void>((resolve) => {
        this.http!.closeAllConnections?.()
        this.http!.close(() => resolve())
      })
      this.http = null
    }
  }
}
