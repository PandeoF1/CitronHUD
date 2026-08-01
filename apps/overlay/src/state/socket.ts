import { io, type Socket } from 'socket.io-client'
import type { ClientToServerEvents, ServerToClientEvents } from '@citronhud/contracts'
import { useOverlay } from './store'

/**
 * Liaison avec le client local.
 *
 * L'overlay tourne dans OBS, souvent lancé avant le client CitronHUD : il doit
 * donc supporter que le serveur n'existe pas encore et se reconnecter
 * indéfiniment sans intervention. Un streamer ne va pas cliquer « actualiser »
 * sur une source navigateur en plein direct.
 */

const OVERLAY_VERSION = __OVERLAY_VERSION__

/**
 * Résout l'adresse du client local.
 *
 * `?server=` permet de pointer une autre machine — utile en régie, où OBS
 * tourne souvent sur un poste différent de celui qui joue.
 */
function resolveEndpoint(): string {
  const params = new URLSearchParams(window.location.search)
  const override = params.get('server')
  if (override) return override
  // Servi par le client lui-même : la même origine est la bonne cible.
  return window.location.origin
}

type OverlaySocket = Socket<ServerToClientEvents, ClientToServerEvents>

/**
 * Référence au socket courant.
 *
 * Gardée au niveau du module pour que les composants puissent émettre sans
 * qu'on ait à faire descendre le socket par les props à travers tout l'arbre —
 * il n'y en a qu'un, et sa durée de vie est celle de la page.
 */
let current: OverlaySocket | null = null

export function connectOverlay(): OverlaySocket {
  const store = useOverlay.getState()

  const socket: OverlaySocket = io(resolveEndpoint(), {
    transports: ['websocket'],
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
    timeout: 4000
  })

  socket.on('connect', () => {
    store.setConnected(true)
    socket.emit('hello', { role: 'overlay', version: OVERLAY_VERSION })
  })

  socket.on('disconnect', () => {
    useOverlay.getState().setConnected(false)
  })

  socket.on('state', (state) => {
    useOverlay.getState().setHud(state)
  })

  socket.on('kills', (kills) => {
    useOverlay.getState().pushKills(kills)
  })

  socket.on('config', (config) => {
    useOverlay.getState().setConfig(config)
  })

  socket.on('highlight', (highlight) => {
    useOverlay.getState().setPendingHighlight(highlight)
  })

  socket.on('replay:play', ({ highlight, clipUrl, durationMs }) => {
    useOverlay.getState().startReplay({ highlight, clipUrl, durationMs })
  })

  socket.on('replay:stop', () => {
    useOverlay.getState().stopReplay()
  })

  socket.on('record:broken', (record) => {
    useOverlay.getState().pushRecord(record)
  })

  socket.on('zest:burst', ({ origin, intensity }) => {
    useOverlay.getState().burst(origin, intensity)
  })

  socket.on('reload', () => {
    window.location.reload()
  })

  current = socket
  return socket
}

/**
 * Signale la fin de lecture d'un replay.
 *
 * Le client garde un verrou pendant la diffusion pour ne pas enchaîner deux
 * replays ; sans cet accusé de réception, une vidéo qui se termine mal
 * bloquerait les temps forts suivants jusqu'au redémarrage.
 *
 * Sans socket (mode démo), l'appel est simplement ignoré.
 */
export function notifyReplayEnded(highlightId: string): void {
  current?.emit('replay:ended', { highlightId })
}
