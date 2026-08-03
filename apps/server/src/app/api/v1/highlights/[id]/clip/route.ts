import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { clipUploadRequestSchema, type Clip } from '@citronhud/contracts'
import { getDb } from '../../../../../../db'
import { highlights } from '../../../../../../db/schema'
import { requireClient } from '../../../../../../lib/guard'
import { fail, json, notFound, parseBody } from '../../../../../../lib/http'
import { presignUpload, storageAvailable } from '../../../../../../lib/s3'
import { toApiHighlight } from '../../../../../../lib/serialize'

type Params = { params: Promise<{ id: string }> }

/** Taille maximale d'un clip : au-delà, c'est un enregistrement, pas un replay. */
const MAX_CLIP_BYTES = 256 * 1024 * 1024

/**
 * Réclame une autorisation de téléversement.
 *
 * La clé de l'objet est dérivée de l'identifiant du temps fort et imposée par
 * le serveur : un client ne choisit pas où il écrit, sinon rien ne l'empêche
 * d'écraser le clip d'une autre régie.
 */
export async function POST(request: Request, { params }: Params): Promise<Response> {
  const guard = await requireClient(request)
  if (guard.error) return guard.error

  if (!storageAvailable()) {
    return fail(503, 'storage_unavailable', "Aucun stockage objet n'est configuré.")
  }

  const body = await parseBody(request, clipUploadRequestSchema)
  if (body.error) return body.error
  if (body.data.sizeBytes > MAX_CLIP_BYTES) {
    return fail(413, 'clip_too_large', 'Clip trop volumineux (256 Mo maximum).')
  }

  const { id } = await params
  const [highlight] = await getDb().select().from(highlights).where(eq(highlights.id, id))
  if (!highlight) return notFound('Temps fort introuvable.')

  const ticket = await presignUpload(`clips/${id}.mp4`, body.data.contentType, body.data.sizeBytes)
  if (!ticket) {
    return fail(503, 'storage_unavailable', "Aucun stockage objet n'est configuré.")
  }

  return json(ticket)
}

const confirmSchema = z.object({
  remoteUrl: z.url(),
  durationMs: z.number().int().min(1).nullable().default(null),
  width: z.number().int().nullable().default(null),
  height: z.number().int().nullable().default(null),
  sizeBytes: z.number().int().nullable().default(null)
})

/**
 * Confirme un téléversement terminé.
 *
 * En deux temps parce que le fichier ne passe pas par le serveur : celui-ci ne
 * peut pas savoir que le PUT vers le stockage a abouti. Tant que cette
 * confirmation n'arrive pas, le clip reste marqué non téléversé — un état faux
 * mais prudent, préférable à une URL affichée dans l'admin qui renverrait 404.
 */
export async function PUT(request: Request, { params }: Params): Promise<Response> {
  const guard = await requireClient(request)
  if (guard.error) return guard.error

  const body = await parseBody(request, confirmSchema)
  if (body.error) return body.error

  const { id } = await params
  const [highlight] = await getDb().select().from(highlights).where(eq(highlights.id, id))
  if (!highlight) return notFound('Temps fort introuvable.')

  const previous = highlight.clip as Clip
  const clip: Clip = {
    ...previous,
    status: 'uploaded',
    remoteUrl: body.data.remoteUrl,
    durationMs: body.data.durationMs ?? previous.durationMs,
    width: body.data.width ?? previous.width,
    height: body.data.height ?? previous.height,
    sizeBytes: body.data.sizeBytes ?? previous.sizeBytes,
    error: null
  }

  const [row] = await getDb()
    .update(highlights)
    .set({ clip })
    .where(eq(highlights.id, id))
    .returning()

  return json(toApiHighlight(row!))
}
