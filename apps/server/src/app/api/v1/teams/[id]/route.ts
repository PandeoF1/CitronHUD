import { and, eq, ne } from 'drizzle-orm'
import { updateTeamSchema } from '@citronhud/contracts'
import { getDb } from '../../../../../db'
import { teams } from '../../../../../db/schema'
import { requireAdmin, requireClient } from '../../../../../lib/guard'
import { fail, json, notFound, parsePatch } from '../../../../../lib/http'
import { slugify } from '../../../../../lib/ids'
import { toApiTeam } from '../../../../../lib/serialize'

type Params = { params: Promise<{ id: string }> }

export async function GET(request: Request, { params }: Params): Promise<Response> {
  const guard = await requireClient(request)
  if (guard.error) return guard.error

  const { id } = await params
  const [row] = await getDb().select().from(teams).where(eq(teams.id, id))
  return row ? json(toApiTeam(row)) : notFound('Équipe introuvable.')
}

export async function PATCH(request: Request, { params }: Params): Promise<Response> {
  const guard = await requireAdmin()
  if (guard.error) return guard.error

  const body = await parsePatch(request, updateTeamSchema)
  if (body.error) return body.error

  const { id } = await params
  const patch = { ...body.data }
  // Drizzle refuse un `set` vide ; un PATCH sans champ n'est pas une erreur,
  // c'est simplement une modification qui ne modifie rien.
  if (Object.keys(patch).length === 0) {
    const [row] = await getDb().select().from(teams).where(eq(teams.id, id))
    return row ? json(toApiTeam(row)) : notFound('Équipe introuvable.')
  }

  if (patch.slug !== undefined) {
    patch.slug = slugify(patch.slug)
    const clash = await getDb()
      .select({ id: teams.id })
      .from(teams)
      .where(and(eq(teams.slug, patch.slug), ne(teams.id, id)))
    if (clash.length > 0) {
      return fail(409, 'slug_taken', `Le slug « ${patch.slug} » est déjà utilisé.`)
    }
  }

  const [row] = await getDb().update(teams).set(patch).where(eq(teams.id, id)).returning()
  return row ? json(toApiTeam(row)) : notFound('Équipe introuvable.')
}

/**
 * Suppression.
 *
 * Les joueurs ne partent pas avec l'équipe : la clé étrangère les repasse à
 * `null`. Dissoudre une équipe ne fait pas disparaître ses joueurs du roster,
 * c'est bien le comportement voulu — et les temps forts déjà archivés gardent
 * le nom d'équipe qu'ils citaient, puisqu'il y est copié et non référencé.
 */
export async function DELETE(_request: Request, { params }: Params): Promise<Response> {
  const guard = await requireAdmin()
  if (guard.error) return guard.error

  const { id } = await params
  const [row] = await getDb().delete(teams).where(eq(teams.id, id)).returning({ id: teams.id })
  return row ? json({ ok: true }) : notFound('Équipe introuvable.')
}
