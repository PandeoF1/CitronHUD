import { count, desc, eq } from 'drizzle-orm'
import { createSessionSchema, paginationQuerySchema } from '@citronhud/contracts'
import { getDb } from '../../../../db'
import { broadcastSessions, highlights } from '../../../../db/schema'
import { requireClient } from '../../../../lib/guard'
import { json, parseBody, parseQuery } from '../../../../lib/http'
import { newId } from '../../../../lib/ids'
import { toApiSession } from '../../../../lib/serialize'

/**
 * Sessions de diffusion.
 *
 * Une session regroupe un live entier : ses temps forts, ses records, ses
 * matchs. C'est la clé de regroupement de l'admin — « la soirée de mardi »
 * plutôt qu'une liste plate de trois cents évènements.
 */

export async function GET(request: Request): Promise<Response> {
  const guard = await requireClient(request)
  if (guard.error) return guard.error

  const query = parseQuery(request, paginationQuerySchema)
  if (query.error) return query.error

  const rows = await getDb()
    .select()
    .from(broadcastSessions)
    .orderBy(desc(broadcastSessions.startedAt))
    .limit(query.data.limit)

  const counts = await Promise.all(
    rows.map(async (row) => {
      const [result] = await getDb()
        .select({ total: count() })
        .from(highlights)
        .where(eq(highlights.sessionId, row.id))
      return result?.total ?? 0
    })
  )

  return json({
    items: rows.map((row, index) => toApiSession(row, counts[index] ?? 0)),
    nextCursor: null
  })
}

export async function POST(request: Request): Promise<Response> {
  const guard = await requireClient(request)
  if (guard.error) return guard.error

  const body = await parseBody(request, createSessionSchema)
  if (body.error) return body.error

  const [row] = await getDb()
    .insert(broadcastSessions)
    .values({
      id: newId(),
      clientId: body.data.clientId,
      clientVersion: body.data.clientVersion,
      label: body.data.label ?? null,
      startedAt: new Date(body.data.startedAt)
    })
    .returning()

  return json(toApiSession(row!), { status: 201 })
}
