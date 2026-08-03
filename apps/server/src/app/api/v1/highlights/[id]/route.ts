import { eq } from 'drizzle-orm'
import { getDb } from '../../../../../db'
import { highlights } from '../../../../../db/schema'
import { requireAdmin, requireClient } from '../../../../../lib/guard'
import { json, notFound } from '../../../../../lib/http'
import { toApiHighlight } from '../../../../../lib/serialize'

type Params = { params: Promise<{ id: string }> }

export async function GET(request: Request, { params }: Params): Promise<Response> {
  const guard = await requireClient(request)
  if (guard.error) return guard.error

  const { id } = await params
  const [row] = await getDb().select().from(highlights).where(eq(highlights.id, id))
  return row ? json(toApiHighlight(row)) : notFound('Temps fort introuvable.')
}

/**
 * Suppression — administrateurs seulement.
 *
 * Un client ne supprime jamais : sa file d'envoi ne fait que rapporter. Laisser
 * une clé de régie effacer l'historique de la structure serait une asymétrie
 * dangereuse pour un gain nul.
 */
export async function DELETE(_request: Request, { params }: Params): Promise<Response> {
  const guard = await requireAdmin()
  if (guard.error) return guard.error

  const { id } = await params
  const [row] = await getDb()
    .delete(highlights)
    .where(eq(highlights.id, id))
    .returning({ id: highlights.id })
  return row ? json({ ok: true }) : notFound('Temps fort introuvable.')
}
