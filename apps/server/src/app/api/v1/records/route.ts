import { and, desc, eq, type SQL } from 'drizzle-orm'
import { recordQuerySchema } from '@citronhud/contracts'
import { getDb } from '../../../../db'
import { records } from '../../../../db/schema'
import { requireClient } from '../../../../lib/guard'
import { json, parseQuery } from '../../../../lib/http'
import { toApiRecord } from '../../../../lib/serialize'

/**
 * Les records en vigueur.
 *
 * Pas de pagination : la table ne contient qu'une ligne par combinaison
 * portée / métrique / sujet, soit quelques centaines de lignes au maximum pour
 * une structure. Le client les charge d'un bloc au démarrage pour savoir ce
 * qu'il doit battre.
 */
export async function GET(request: Request): Promise<Response> {
  const guard = await requireClient(request)
  if (guard.error) return guard.error

  const query = parseQuery(request, recordQuerySchema)
  if (query.error) return query.error
  const { scope, metric, steamId, teamId, limit } = query.data

  const filters = [
    scope ? eq(records.scope, scope) : undefined,
    metric ? eq(records.metric, metric) : undefined,
    steamId ? eq(records.steamId, steamId) : undefined,
    teamId ? eq(records.teamId, teamId) : undefined
  ].filter((clause): clause is SQL => clause !== undefined)

  const rows = await getDb()
    .select()
    .from(records)
    .where(filters.length > 0 ? and(...filters) : undefined)
    .orderBy(desc(records.achievedAt))
    .limit(limit)

  return json({ items: rows.map(toApiRecord) })
}
