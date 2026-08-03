import { count, eq } from 'drizzle-orm'
import { z } from 'zod'
import { getDb } from '../../../../../db'
import { broadcastSessions, highlights } from '../../../../../db/schema'
import { requireAdmin, requireClient } from '../../../../../lib/guard'
import { json, notFound, parseBody } from '../../../../../lib/http'
import { toApiSession } from '../../../../../lib/serialize'

type Params = { params: Promise<{ id: string }> }

const patchSessionSchema = z.object({
  label: z.string().max(120).nullable().optional(),
  endedAt: z.iso.datetime().nullable().optional()
})

export async function GET(request: Request, { params }: Params): Promise<Response> {
  const guard = await requireClient(request)
  if (guard.error) return guard.error

  const { id } = await params
  const [row] = await getDb().select().from(broadcastSessions).where(eq(broadcastSessions.id, id))
  if (!row) return notFound('Session introuvable.')

  const [total] = await getDb()
    .select({ total: count() })
    .from(highlights)
    .where(eq(highlights.sessionId, id))

  return json(toApiSession(row, total?.total ?? 0))
}

/** Clôture ou renomme une session — le client peut clore la sienne. */
export async function PATCH(request: Request, { params }: Params): Promise<Response> {
  const guard = await requireClient(request)
  if (guard.error) return guard.error

  const body = await parseBody(request, patchSessionSchema)
  if (body.error) return body.error

  const { id } = await params
  const patch: Partial<typeof broadcastSessions.$inferInsert> = {}
  if (body.data.label !== undefined) patch.label = body.data.label
  if (body.data.endedAt !== undefined) {
    patch.endedAt = body.data.endedAt === null ? null : new Date(body.data.endedAt)
  }

  const [row] = await getDb()
    .update(broadcastSessions)
    .set(patch)
    .where(eq(broadcastSessions.id, id))
    .returning()
  return row ? json(toApiSession(row)) : notFound('Session introuvable.')
}

/**
 * Suppression — administrateurs seulement.
 *
 * Les temps forts de la session ne sont pas supprimés avec elle : ils portent
 * leur propre historique et l'admin peut vouloir garder un ace après avoir fait
 * le ménage dans des sessions de test.
 */
export async function DELETE(_request: Request, { params }: Params): Promise<Response> {
  const guard = await requireAdmin()
  if (guard.error) return guard.error

  const { id } = await params
  const [row] = await getDb()
    .delete(broadcastSessions)
    .where(eq(broadcastSessions.id, id))
    .returning({ id: broadcastSessions.id })
  return row ? json({ ok: true }) : notFound('Session introuvable.')
}
