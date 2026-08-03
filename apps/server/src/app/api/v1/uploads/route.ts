import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { requireAdmin } from '../../../../lib/guard'
import { fail, json, parseBody } from '../../../../lib/http'
import { presignUpload, storageAvailable } from '../../../../lib/s3'

/**
 * Téléversement d'images du roster — avatars de joueurs, logos d'équipes.
 *
 * Réservé aux administrateurs : ces images sont éditoriales, au même titre que
 * les pseudos. Une clé de régie n'a rien à écrire ici.
 */

/**
 * Types acceptés, en liste blanche.
 *
 * Le stockage sert les fichiers derrière le domaine de la structure. Accepter
 * `image/svg+xml` ou un type arbitraire y ferait héberger du script exécuté
 * dans l'origine du site — une faille XSS ouverte par un simple envoi de logo.
 */
const EXTENSIONS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/avif': 'avif'
}

/** 8 Mo : très au-dessus d'un avatar raisonnable, très en dessous d'un abus. */
const MAX_IMAGE_BYTES = 8 * 1024 * 1024

const uploadRequestSchema = z.object({
  kind: z.enum(['avatar', 'logo']),
  contentType: z.string(),
  sizeBytes: z.number().int().min(1)
})

export async function POST(request: Request): Promise<Response> {
  const guard = await requireAdmin()
  if (guard.error) return guard.error

  if (!storageAvailable()) {
    return fail(503, 'storage_unavailable', "Aucun stockage objet n'est configuré.")
  }

  const body = await parseBody(request, uploadRequestSchema)
  if (body.error) return body.error

  const extension = EXTENSIONS[body.data.contentType]
  if (!extension) {
    return fail(415, 'unsupported_type', 'Formats acceptés : PNG, JPEG, WebP, AVIF.')
  }
  if (body.data.sizeBytes > MAX_IMAGE_BYTES) {
    return fail(413, 'file_too_large', 'Image trop volumineuse (8 Mo maximum).')
  }

  const folder = body.data.kind === 'avatar' ? 'avatars' : 'logos'
  const ticket = await presignUpload(
    `${folder}/${randomUUID()}.${extension}`,
    body.data.contentType,
    body.data.sizeBytes
  )
  if (!ticket) {
    return fail(503, 'storage_unavailable', "Aucun stockage objet n'est configuré.")
  }

  return json(ticket)
}
