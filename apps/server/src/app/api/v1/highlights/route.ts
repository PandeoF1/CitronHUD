import { and, desc, eq, sql, type SQL } from 'drizzle-orm'
import {
  createHighlightRequestSchema,
  highlightListQuerySchema,
  idSchema
} from '@citronhud/contracts'
import { getDb } from '../../../../db'
import { broadcastSessions, highlights } from '../../../../db/schema'
import { requireClient } from '../../../../lib/guard'
import { json, parseBody, parseQuery } from '../../../../lib/http'
import { newId } from '../../../../lib/ids'
import { toApiHighlight } from '../../../../lib/serialize'

/**
 * Temps forts rapportés par les clients.
 *
 * L'identifiant est accepté tel que le client l'a produit : il l'a déjà écrit
 * dans sa base locale et diffusé à son overlay. Le renvoi devient alors
 * idempotent — une file d'envoi rejouée après une coupure ne crée pas trois
 * fois le même ace.
 */
const postSchema = createHighlightRequestSchema.extend({ id: idSchema.optional() })

/**
 * Curseur composite.
 *
 * L'horodatage seul ne suffit pas : deux temps forts peuvent tomber dans la
 * même milliseconde — un ace et le record qu'il bat, par construction — et
 * paginer dessus en sauterait un. Le couple `(occurredAt, id)` est unique.
 */
function beforeCursor(cursor: string | undefined): SQL | undefined {
  if (!cursor) return undefined
  const separator = cursor.lastIndexOf('|')
  if (separator === -1) return undefined
  const at = cursor.slice(0, separator)
  const id = cursor.slice(separator + 1)
  if (Number.isNaN(Date.parse(at))) return undefined
  return sql`(${highlights.occurredAt}, ${highlights.id}) < (${new Date(at)}, ${id})`
}

const cursorOf = (row: { occurredAt: Date; id: string }) =>
  `${row.occurredAt.toISOString()}|${row.id}`

export async function GET(request: Request): Promise<Response> {
  const guard = await requireClient(request)
  if (guard.error) return guard.error

  const query = parseQuery(request, highlightListQuerySchema)
  if (query.error) return query.error
  const { sessionId, steamId, kind, limit, cursor } = query.data

  const filters = [
    sessionId ? eq(highlights.sessionId, sessionId) : undefined,
    steamId ? eq(highlights.steamId, steamId) : undefined,
    kind ? eq(highlights.kind, kind) : undefined,
    beforeCursor(cursor)
  ].filter((clause): clause is SQL => clause !== undefined)

  const rows = await getDb()
    .select()
    .from(highlights)
    .where(filters.length > 0 ? and(...filters) : undefined)
    .orderBy(desc(highlights.occurredAt), desc(highlights.id))
    .limit(limit + 1)

  const hasMore = rows.length > limit
  const visible = hasMore ? rows.slice(0, limit) : rows
  const last = visible[visible.length - 1]

  return json({
    items: visible.map(toApiHighlight),
    nextCursor: hasMore && last ? cursorOf(last) : null
  })
}

export async function POST(request: Request): Promise<Response> {
  const guard = await requireClient(request)
  if (guard.error) return guard.error

  const body = await parseBody(request, postSchema)
  if (body.error) return body.error
  const highlight = body.data
  const id = highlight.id ?? newId()

  const [existing] = await getDb().select().from(highlights).where(eq(highlights.id, id))
  if (existing) {
    // Déjà connu : la file d'envoi du client peut passer à l'entrée suivante.
    return json(toApiHighlight(existing))
  }

  await ensureSession(highlight.sessionId, guard.actor.clientVersion)

  const [row] = await getDb()
    .insert(highlights)
    .values({
      id,
      sessionId: highlight.sessionId,
      kind: highlight.kind,
      matchId: highlight.matchId,
      steamId: highlight.steamId,
      playerName: highlight.playerName,
      playerAvatarUrl: highlight.playerAvatarUrl,
      teamId: highlight.teamId,
      teamName: highlight.teamName,
      side: highlight.side,
      slot: highlight.slot,
      mapName: highlight.mapName,
      round: highlight.round,
      scoreLeft: highlight.scoreAt.left,
      scoreRight: highlight.scoreAt.right,
      killCount: highlight.killCount,
      clutchAgainst: highlight.clutchAgainst,
      victims: highlight.victims,
      weapons: highlight.weapons,
      headshots: highlight.headshots,
      occurredAt: new Date(highlight.occurredAt),
      clip: highlight.clip
    })
    .returning()

  return json(toApiHighlight(row!), { status: 201 })
}

/**
 * Crée la session au vol si le client ne l'a jamais déclarée.
 *
 * Le client génère son identifiant de session localement et n'appelle pas
 * `POST /sessions` — il n'a aucune raison d'attendre le réseau pour commencer à
 * diffuser. Sans ce rattrapage, tous ses temps forts se retrouveraient rattachés
 * à une session absente et l'admin n'aurait plus de quoi les regrouper.
 */
async function ensureSession(sessionId: string, clientVersion: string | null): Promise<void> {
  const [known] = await getDb()
    .select({ id: broadcastSessions.id })
    .from(broadcastSessions)
    .where(eq(broadcastSessions.id, sessionId))
  if (known) return

  await getDb()
    .insert(broadcastSessions)
    .values({
      id: sessionId,
      clientId: 'inconnu',
      clientVersion: clientVersion ?? 'inconnue',
      label: null,
      startedAt: new Date()
    })
    .onConflictDoNothing()
}
