import { and, eq, ne } from 'drizzle-orm'
import { updatePlayerSchema } from '@citronhud/contracts'
import { getDb } from '../../../../../db'
import { players } from '../../../../../db/schema'
import { requireAdmin, requireClient } from '../../../../../lib/guard'
import { fail, json, notFound, parsePatch } from '../../../../../lib/http'
import { toApiPlayer } from '../../../../../lib/serialize'

type Params = { params: Promise<{ id: string }> }

export async function GET(request: Request, { params }: Params): Promise<Response> {
  const guard = await requireClient(request)
  if (guard.error) return guard.error

  const { id } = await params
  const [row] = await getDb().select().from(players).where(eq(players.id, id))
  return row ? json(toApiPlayer(row)) : notFound('Joueur introuvable.')
}

export async function PATCH(request: Request, { params }: Params): Promise<Response> {
  const guard = await requireAdmin()
  if (guard.error) return guard.error

  const body = await parsePatch(request, updatePlayerSchema)
  if (body.error) return body.error

  const { id } = await params
  // Drizzle refuse un `set` vide ; un PATCH sans champ n'est pas une erreur.
  if (Object.keys(body.data).length === 0) {
    const [row] = await getDb().select().from(players).where(eq(players.id, id))
    return row ? json(toApiPlayer(row)) : notFound('Joueur introuvable.')
  }

  if (body.data.steamId !== undefined) {
    const clash = await getDb()
      .select({ id: players.id })
      .from(players)
      .where(and(eq(players.steamId, body.data.steamId), ne(players.id, id)))
    if (clash.length > 0) {
      return fail(409, 'steam_id_taken', 'Ce SteamID est déjà attribué à un joueur.')
    }
  }

  const [row] = await getDb().update(players).set(body.data).where(eq(players.id, id)).returning()
  return row ? json(toApiPlayer(row)) : notFound('Joueur introuvable.')
}

export async function DELETE(_request: Request, { params }: Params): Promise<Response> {
  const guard = await requireAdmin()
  if (guard.error) return guard.error

  const { id } = await params
  const [row] = await getDb().delete(players).where(eq(players.id, id)).returning({
    id: players.id
  })
  return row ? json({ ok: true }) : notFound('Joueur introuvable.')
}
