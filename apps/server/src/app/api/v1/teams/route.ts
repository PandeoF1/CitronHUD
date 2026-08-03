import { eq } from 'drizzle-orm'
import { createTeamRequestSchema, paginationQuerySchema } from '@citronhud/contracts'
import { getDb } from '../../../../db'
import { teams } from '../../../../db/schema'
import { requireAdmin, requireClient } from '../../../../lib/guard'
import { fail, json, parseBody, parseQuery } from '../../../../lib/http'
import { newId, slugify } from '../../../../lib/ids'
import { after, byCursor, paginate } from '../../../../lib/pagination'
import { toApiTeam } from '../../../../lib/serialize'

export async function GET(request: Request): Promise<Response> {
  const guard = await requireClient(request)
  if (guard.error) return guard.error

  const query = parseQuery(request, paginationQuerySchema)
  if (query.error) return query.error
  const { limit, cursor } = query.data

  const rows = await getDb()
    .select()
    .from(teams)
    .where(after(teams.id, cursor))
    .orderBy(byCursor(teams.id))
    .limit(limit + 1)

  return json(paginate(rows, limit, toApiTeam, (row) => row.id))
}

/**
 * Création d'une équipe — réservée aux administrateurs.
 *
 * Le slug est dérivé du nom quand il est absent, puis vérifié : c'est lui qui
 * apparaît dans les URL de l'admin, et deux équipes ne peuvent pas le partager.
 */
export async function POST(request: Request): Promise<Response> {
  const guard = await requireAdmin()
  if (guard.error) return guard.error

  const body = await parseBody(request, createTeamRequestSchema)
  if (body.error) return body.error

  const slug = slugify(body.data.slug || body.data.name)
  const clash = await getDb().select({ id: teams.id }).from(teams).where(eq(teams.slug, slug))
  if (clash.length > 0) {
    return fail(409, 'slug_taken', `Le slug « ${slug} » est déjà utilisé.`)
  }

  const [row] = await getDb()
    .insert(teams)
    .values({ id: newId(), ...body.data, slug, createdBy: guard.actor.id })
    .returning()

  return json(toApiTeam(row!), { status: 201 })
}
