import { and, eq } from 'drizzle-orm'
import {
  beatsRecord,
  type CreateRecord,
  type GameRecord,
  type RecordMetric,
  type RecordScope
} from '@citronhud/contracts'
import { z } from 'zod'
import { getDb } from '../db'
import { records } from '../db/schema'
import { newId } from './ids'
import { toApiRecord } from './serialize'

/**
 * Arbitrage des records.
 *
 * L'arbitrage est **toujours côté serveur**. Le client propose des candidats
 * accumulés hors ligne ; c'est ici qu'on décide lesquels font autorité. Laisser
 * le client trancher ouvrirait la porte à une machine dont l'horloge dérive, à
 * un client d'une version antérieure dont le comptage a changé, ou à un fichier
 * de configuration modifié à la main — trois façons d'inscrire un record que
 * personne n'a réalisé.
 */

/**
 * Deux formes acceptées sur `/records/sync`.
 *
 * Le contrat décrit une enveloppe `{ sessionId, candidates[] }`, mais la file
 * d'envoi du client empile un évènement `RecordBroken` par record tombé et les
 * poste un par un. Refuser cette seconde forme laisserait chaque record hors
 * ligne coincé dans la file jusqu'à son abandon au bout de dix tentatives —
 * c'est-à-dire perdre exactement les records que la synchronisation existe pour
 * rattraper. On accepte donc les deux et on normalise ici.
 */
const syncEnvelopeSchema = z.object({
  sessionId: z.string().min(1),
  candidates: z.array(z.unknown())
})

/** Candidat normalisé, quelle que soit la forme reçue. */
export interface RecordCandidate {
  scope: RecordScope
  metric: RecordMetric
  steamId: string | null
  playerName: string | null
  playerAvatarUrl: string | null
  teamId: string | null
  teamName: string | null
  value: number
  mapName: string | null
  matchId: string | null
  sessionId: string | null
  achievedAt: string
}

function candidateFrom(raw: unknown, sessionId: string | null, receivedAt: Date): RecordCandidate | null {
  if (typeof raw !== 'object' || raw === null) return null
  const source = raw as Partial<CreateRecord> & { achievedAt?: string }

  if (typeof source.metric !== 'string' || typeof source.scope !== 'string') return null
  if (typeof source.value !== 'number' || !Number.isFinite(source.value)) return null

  return {
    scope: source.scope as RecordScope,
    metric: source.metric as RecordMetric,
    steamId: source.steamId ?? null,
    playerName: source.playerName ?? null,
    playerAvatarUrl: source.playerAvatarUrl ?? null,
    teamId: source.teamId ?? null,
    teamName: source.teamName ?? null,
    value: source.value,
    mapName: source.mapName ?? null,
    matchId: source.matchId ?? null,
    sessionId: source.sessionId ?? sessionId,
    achievedAt: clampAchievedAt(source.achievedAt, receivedAt)
  }
}

/**
 * Écart d'horloge toléré avant de retenir l'heure du serveur.
 *
 * Une heure : les machines de régie sont souvent hors domaine et leur horloge
 * dérive. On **conserve** le record en corrigeant sa date plutôt que de le
 * refuser — un ace reste un ace même sur une machine mal réglée, et rejeter
 * pour ce motif ferait disparaître silencieusement des performances réelles.
 */
const CLOCK_SKEW_MS = 60 * 60 * 1000

export function clampAchievedAt(value: string | undefined, receivedAt: Date): string {
  if (!value) return receivedAt.toISOString()
  const parsed = Date.parse(value)
  if (Number.isNaN(parsed)) return receivedAt.toISOString()
  if (parsed > receivedAt.getTime() + CLOCK_SKEW_MS) return receivedAt.toISOString()
  return new Date(parsed).toISOString()
}

/**
 * Sujet du record, sous forme d'une clé non nulle.
 *
 * La portée globale n'a pas de sujet : une seule ligne par métrique, quel que
 * soit le détenteur. Les portées joueur et équipe en exigent un — sans lui, on
 * ne saurait pas à qui comparer, et tous les joueurs partageraient une ligne.
 */
export function subjectKeyOf(candidate: RecordCandidate): string | null {
  switch (candidate.scope) {
    case 'global':
      return ''
    case 'player':
      return candidate.steamId ?? null
    case 'team':
      return candidate.teamId ?? null
    default:
      return null
  }
}

export interface SyncOutcome {
  accepted: GameRecord[]
  rejected: Array<{ metric: RecordMetric; steamId: string | null; reason: string }>
}

/**
 * Normalise le corps reçu en liste de candidats.
 *
 * Exportée pour être testable sans base : c'est la partie qui absorbe les deux
 * formes d'entrée, donc celle qui casse en silence si elle se trompe.
 */
export function candidatesFrom(body: unknown, receivedAt = new Date()): RecordCandidate[] {
  const envelope = syncEnvelopeSchema.safeParse(body)
  if (envelope.success) {
    return envelope.data.candidates
      .map((item) => candidateFrom(item, envelope.data.sessionId, receivedAt))
      .filter((item): item is RecordCandidate => item !== null)
  }

  const single = candidateFrom(body, null, receivedAt)
  return single ? [single] : []
}

/**
 * Confronte les candidats aux records en place.
 *
 * Chaque record est verrouillé le temps de sa comparaison : deux régies qui
 * synchronisent en même temps le même record se retrouveraient sinon à lire
 * toutes les deux l'ancienne valeur, et la seconde écriture écraserait la
 * meilleure des deux par la moins bonne.
 */
export async function syncRecords(candidates: RecordCandidate[]): Promise<SyncOutcome> {
  const outcome: SyncOutcome = { accepted: [], rejected: [] }

  for (const candidate of candidates) {
    const subjectKey = subjectKeyOf(candidate)
    if (subjectKey === null) {
      outcome.rejected.push({
        metric: candidate.metric,
        steamId: candidate.steamId,
        reason: `Portée « ${candidate.scope} » sans sujet identifiable.`
      })
      continue
    }

    const result = await getDb().transaction(async (tx) => {
      const existing = await tx
        .select()
        .from(records)
        .where(
          and(
            eq(records.scope, candidate.scope),
            eq(records.metric, candidate.metric),
            eq(records.subjectKey, subjectKey)
          )
        )
        .for('update')
        .limit(1)

      const current = existing[0] ?? null
      if (current && !beatsRecord(candidate.metric, candidate.value, current.value)) {
        return { kind: 'rejected' as const, reason: `Record en place à ${current.value}.` }
      }

      const row = {
        scope: candidate.scope,
        metric: candidate.metric,
        subjectKey,
        steamId: candidate.steamId,
        playerName: candidate.playerName,
        playerAvatarUrl: candidate.playerAvatarUrl,
        teamId: candidate.teamId,
        teamName: candidate.teamName,
        value: candidate.value,
        // La valeur détrônée vient de la base, jamais du client : c'est elle
        // qu'affiche le bandeau « 32 → 34 », et un client en retard proposerait
        // un « avant » qui n'a plus cours.
        previousValue: current?.value ?? null,
        mapName: candidate.mapName,
        matchId: candidate.matchId,
        sessionId: candidate.sessionId,
        achievedAt: new Date(candidate.achievedAt)
      }

      const [saved] = current
        ? await tx.update(records).set(row).where(eq(records.id, current.id)).returning()
        : await tx
            .insert(records)
            .values({ id: newId(), ...row })
            .returning()

      return { kind: 'accepted' as const, row: saved! }
    })

    if (result.kind === 'accepted') {
      outcome.accepted.push(toApiRecord(result.row))
    } else {
      outcome.rejected.push({
        metric: candidate.metric,
        steamId: candidate.steamId,
        reason: result.reason
      })
    }
  }

  return outcome
}
