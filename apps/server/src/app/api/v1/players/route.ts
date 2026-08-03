import { eq } from 'drizzle-orm'
import { createPlayerRequestSchema, paginationQuerySchema } from '@citronhud/contracts'
import { getDb } from '../../../../db'
import { players } from '../../../../db/schema'
import { requireAdmin, requireClient } from '../../../../lib/guard'
import { fail, json, parseBody, parseQuery } from '../../../../lib/http'
import { newId } from '../../../../lib/ids'
import { after, byCursor, paginate } from '../../../../lib/pagination'
import { toApiPlayer } from '../../../../lib/serialize'

export async function GET(request: Request): Promise<Response> {
  const guard = await requireClient(request)
  if (guard.error) return guard.error

  const query = parseQuery(request, paginationQuerySchema)
  if (query.error) return query.error
  const { limit, cursor } = query.data

  const rows = await getDb()
    .select()
    .from(players)
    .where(after(players.id, cursor))
    .orderBy(byCursor(players.id))
    .limit(limit + 1)

  return json(paginate(rows, limit, toApiPlayer, (row) => row.id))
}

/**
 * Création d'un joueur.
 *
 * Le SteamID est la seule clé qui relie le roster au flux du jeu ; le déclarer
 * deux fois rendrait indéterminé le pseudo affiché à l'antenne. On refuse donc
 * explicitement plutôt que de laisser remonter une violation de contrainte.
 */
export async function POST(request: Request): Promise<Response> {
  const guard = await requireAdmin()
  if (guard.error) return guard.error

  const body = await parseBody(request, createPlayerRequestSchema)
  if (body.error) return body.error

  const clash = await getDb()
    .select({ id: players.id })
    .from(players)
    .where(eq(players.steamId, body.data.steamId))
  if (clash.length > 0) {
    return fail(409, 'steam_id_taken', 'Ce SteamID est déjà attribué à un joueur.')
  }

  const [row] = await getDb()
    .insert(players)
    .values({ id: newId(), ...body.data })
    .returning()

  return json(toApiPlayer(row!), { status: 201 })
}
