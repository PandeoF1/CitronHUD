import type { HudConfig } from './config'
import type { HudState, KillEvent } from './hud-state'
import type { Highlight } from './highlight'
import type { RecordBroken } from './record'

/**
 * Protocole temps réel entre le client local et l'overlay.
 *
 * Deux salons : `overlay` (les sources navigateur dans OBS) et `control` (le
 * panneau du client). L'overlay ne reçoit que ce qu'il doit dessiner ; le
 * panneau reçoit en plus les diagnostics, qui n'ont rien à faire à l'antenne.
 */

export const SOCKET_ROOM = {
  overlay: 'overlay',
  control: 'control'
} as const

/** Évènements émis par le serveur local vers ses clients. */
export interface ServerToClientEvents {
  /** État complet. Émis à la connexion puis à chaque frame GSI. */
  state: (state: HudState) => void

  /**
   * Kills reconstruits depuis la dernière frame.
   *
   * Envoyés séparément de `state` parce que le killfeed est un flux
   * d'évènements, pas un état : rejouer un état complet ne doit pas rejouer les
   * animations d'entrée des kills déjà affichés.
   */
  kills: (events: KillEvent[]) => void

  /** Un temps fort vient d'être détecté. Le clip n'est pas encore prêt. */
  highlight: (highlight: Highlight) => void

  /** Le clip est prêt : l'overlay peut le lire. */
  'replay:play': (payload: { highlight: Highlight; clipUrl: string; durationMs: number }) => void

  /** Coupe le replay en cours (fin naturelle ou interruption par l'opérateur). */
  'replay:stop': (payload: { reason: 'ended' | 'cancelled' | 'error' }) => void

  /** Un record est tombé. */
  'record:broken': (record: RecordBroken) => void

  /** La configuration du HUD a changé. */
  config: (config: HudConfig) => void

  /**
   * Demande de rechargement de l'overlay.
   *
   * Utilisé après une mise à jour du bundle : évite au streamer d'aller
   * cliquer « actualiser » sur la source navigateur dans OBS.
   */
  reload: () => void

  /** Déclenche une gerbe de zestes sans temps fort associé (bouton manuel). */
  'zest:burst': (payload: { origin: 'left' | 'right' | 'center'; intensity: number }) => void
}

/** Évènements émis par les clients vers le serveur local. */
export interface ClientToServerEvents {
  /** Annonce le type de client ; détermine le salon rejoint. */
  hello: (payload: { role: 'overlay' | 'control'; version: string }) => void

  /** L'overlay signale la fin de lecture d'un replay. */
  'replay:ended': (payload: { highlightId: string }) => void

  /** Le panneau demande une gerbe de zestes. */
  'zest:trigger': (payload: { origin: 'left' | 'right' | 'center' }) => void
}

export interface InterServerEvents {
  ping: () => void
}

export interface SocketData {
  role: 'overlay' | 'control'
  version: string
}
