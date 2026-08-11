import type { ConnectionStatus } from '@citronhud/contracts'

/**
 * Bandeau d'état.
 *
 * Quatre voyants, toujours visibles. Chaque libellé dit ce qui SE PASSE, pas ce
 * qui est configuré : « En attente de CS2 » est actionnable, « GSI : true » ne
 * l'est pas. Les couleurs suivent la même règle — l'orange signale qu'une
 * action est possible, jamais qu'une valeur est simplement absente.
 */

type Tone = 'ok' | 'warn' | 'idle' | 'bad'

interface Lamp {
  label: string
  value: string
  tone: Tone
}

/**
 * Seuil en dessous duquel le flux est réellement anormal.
 *
 * Mesuré contre CS2 en observateur : le jeu émet environ **huit trames par
 * seconde** alors que le fichier GSI en demande une toutes les 30 ms. Ce n'est
 * ni la faute du fichier, ni celle du relais — mesuré à 32 trames/s de bout en
 * bout sur un flux synthétique — mais un plafond du jeu lui-même.
 *
 * Le seuil est donc placé bas : avertir à vingt reviendrait à afficher une
 * alerte permanente sur un fonctionnement parfaitement normal. À moins de cinq
 * trames par seconde, en revanche, quelque chose ne va pas.
 *
 * La fluidité perçue se règle côté overlay, en interpolant entre deux trames —
 * ce que le radar fait déjà.
 */
const SMOOTH_RATE_THRESHOLD = 5

function gsiLamp(status: ConnectionStatus): Lamp {
  switch (status.gsi) {
    case 'live': {
      /*
       * L'absence des dix joueurs prime sur la cadence, et de loin. CS2 ne
       * fournit `allplayers` qu'en mode observateur : sans lui, ni effectifs, ni
       * radar, ni killfeed. Afficher « flux irrégulier » dans ce cas enverrait
       * chercher un problème de performance là où il n'y en a pas.
       */
      if (status.gsiPlayers === 0) {
        return {
          label: 'CS2',
          value: 'Passez en observateur — CS2 n’envoie pas les joueurs',
          tone: 'bad'
        }
      }
      if (status.gsiRate === null) {
        return { label: 'CS2', value: 'Données en direct', tone: 'ok' }
      }
      const rate = `${status.gsiRate.toFixed(0)} trames/s`
      return status.gsiRate < SMOOTH_RATE_THRESHOLD
        ? { label: 'CS2', value: `${rate} — flux anormalement lent`, tone: 'warn' }
        : { label: 'CS2', value: `Données en direct — ${rate}`, tone: 'ok' }
    }
    case 'stale':
      return { label: 'CS2', value: 'Flux interrompu', tone: 'warn' }
    default:
      return { label: 'CS2', value: 'En attente d’une partie', tone: 'idle' }
  }
}

function serverLamp(status: ConnectionStatus): Lamp {
  switch (status.server) {
    case 'online':
      return { label: 'Serveur', value: 'Synchronisé', tone: 'ok' }
    case 'syncing':
      return { label: 'Serveur', value: 'Synchronisation…', tone: 'idle' }
    case 'offline':
      // Hors ligne n'est pas une panne : le client tourne sur son cache.
      return { label: 'Serveur', value: 'Hors ligne — cache local', tone: 'warn' }
    case 'unauthorized':
      return { label: 'Serveur', value: 'Clé d’API refusée', tone: 'bad' }
    default:
      return { label: 'Serveur', value: 'Mode local', tone: 'idle' }
  }
}

function obsLamp(status: ConnectionStatus): Lamp {
  switch (status.obs) {
    case 'connected':
      return { label: 'OBS', value: 'Connecté', tone: 'ok' }
    case 'connecting':
      return { label: 'OBS', value: 'Connexion…', tone: 'idle' }
    case 'auth_failed':
      return { label: 'OBS', value: 'Mot de passe refusé', tone: 'bad' }
    case 'unreachable':
      return { label: 'OBS', value: 'Injoignable', tone: 'warn' }
    default:
      return { label: 'OBS', value: 'Désactivé', tone: 'idle' }
  }
}

function captureLamp(status: ConnectionStatus): Lamp {
  switch (status.capture) {
    case 'obs':
      return { label: 'Replays', value: 'Tampon OBS', tone: 'ok' }
    case 'internal':
      return { label: 'Replays', value: 'Capture interne', tone: 'ok' }
    case 'unavailable':
      return { label: 'Replays', value: 'Aucune capture disponible', tone: 'warn' }
    default:
      return { label: 'Replays', value: 'Désactivés', tone: 'idle' }
  }
}

export function StatusStrip({ status }: { status: ConnectionStatus }) {
  const lamps = [gsiLamp(status), serverLamp(status), obsLamp(status), captureLamp(status)]

  return (
    <div className="strip">
      {lamps.map((lamp) => (
        <div key={lamp.label} className="lamp" data-tone={lamp.tone}>
          <span className="lamp__dot" aria-hidden="true" />
          <span className="lamp__label">{lamp.label}</span>
          <span className="lamp__value">{lamp.value}</span>
        </div>
      ))}

      <div className="lamp lamp--wide" data-tone={status.overlay.connected > 0 ? 'ok' : 'idle'}>
        <span className="lamp__dot" aria-hidden="true" />
        <span className="lamp__label">Overlay</span>
        <span className="lamp__value">
          {status.overlay.connected > 0
            ? `${status.overlay.connected} source${status.overlay.connected > 1 ? 's' : ''} connectée${status.overlay.connected > 1 ? 's' : ''}`
            : 'Aucune source connectée'}
        </span>
      </div>
    </div>
  )
}
