import { randomUUID } from 'node:crypto'
import {
  matchSetupSchema,
  type MatchSetup,
  type Side,
  type Slot,
  type TeamSlot
} from '@citronhud/contracts'
import { getMeta, setMeta } from './db'

/**
 * Le match courant — la seule chose que le streamer configure.
 *
 * Persisté en base plutôt qu'en mémoire : redémarrer le client en plein match,
 * ou après un plantage d'OBS, doit retrouver les mêmes équipes aux mêmes
 * places. Perdre cette sélection en direct oblige à tout refaire à l'antenne.
 */

const MATCH_KEY = 'match:current'

function blankMatch(): MatchSetup {
  const now = new Date().toISOString()
  return matchSetupSchema.parse({
    id: randomUUID(),
    format: 'bo1',
    left: { source: 'unset' },
    right: { source: 'unset' },
    sides: { mode: 'auto', leftSide: 'CT', confidence: 0, matchedPlayers: 0, overridden: false },
    createdAt: now,
    updatedAt: now
  })
}

let cache: MatchSetup | null = null

export function getMatch(): MatchSetup {
  if (cache) return cache
  const raw = getMeta(MATCH_KEY)
  if (!raw) {
    cache = blankMatch()
    return cache
  }
  try {
    cache = matchSetupSchema.parse(JSON.parse(raw))
  } catch {
    // Sélection illisible (version antérieure, écriture interrompue) : repartir
    // d'un match vide vaut mieux que de refuser de démarrer.
    cache = blankMatch()
  }
  return cache
}

function persist(match: MatchSetup): MatchSetup {
  cache = { ...match, updatedAt: new Date().toISOString() }
  setMeta(MATCH_KEY, JSON.stringify(cache))
  return cache
}

export function updateMatch(patch: Partial<MatchSetup>): MatchSetup {
  return persist(matchSetupSchema.parse({ ...getMatch(), ...patch }))
}

/** Affecte une équipe à un côté de l'écran. */
export function setTeamSlot(slot: Slot, team: TeamSlot): MatchSetup {
  return updateMatch({ [slot]: team } as Partial<MatchSetup>)
}

/**
 * Échange les deux équipes de position à l'écran.
 *
 * À distinguer de l'inversion des camps : ici on déplace les équipes de gauche
 * à droite, ce qui sert quand la régie veut coller à la disposition physique
 * d'une scène. L'inversion des camps, elle, corrige une mauvaise détection.
 */
export function swapTeamSlots(): MatchSetup {
  const match = getMatch()
  return updateMatch({ left: match.right, right: match.left })
}

/** Fige ou libère l'affectation des camps. */
export function setSideMode(mode: 'auto' | 'manual', leftSide?: Side): MatchSetup {
  const match = getMatch()
  return updateMatch({
    sides: {
      ...match.sides,
      mode,
      leftSide: leftSide ?? match.sides.leftSide,
      overridden: mode === 'manual'
    }
  })
}

/** Nouveau match : conserve les équipes, remet scores et vetos à zéro. */
export function resetMatch(keepTeams = true): MatchSetup {
  const previous = getMatch()
  const fresh = blankMatch()
  if (!keepTeams) return persist(fresh)
  return persist({
    ...fresh,
    left: previous.left,
    right: previous.right,
    format: previous.format,
    event: previous.event
  })
}
