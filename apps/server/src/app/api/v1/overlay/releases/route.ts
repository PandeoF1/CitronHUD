import { desc } from 'drizzle-orm'
import { getDb } from '../../../../../db'
import { overlayReleases } from '../../../../../db/schema'
import { requireAdmin } from '../../../../../lib/guard'
import { fail, json } from '../../../../../lib/http'
import { publishRelease } from '../../../../../lib/overlay-release'

/**
 * Publication d'un bundle d'overlay.
 *
 * Réservé à une session d'administration, pas ouvert aux clés d'API : une clé
 * vit sur la machine d'un streamer, et ce point d'entrée pousse du code qui
 * s'exécutera automatiquement dans la source navigateur de toutes les régies.
 * C'est le levier le plus puissant du serveur ; il reste derrière la porte la
 * mieux fermée.
 *
 * Existe en plus du formulaire d'administration parce qu'un bundle sera plus
 * souvent publié par une chaîne d'intégration que par quelqu'un à la souris.
 */

const STATUS: Record<string, number> = {
  no_storage: 503,
  too_large: 413,
  not_a_zip: 415,
  missing_index: 422,
  duplicate_version: 409,
  storage_refused: 502
}

export async function GET(): Promise<Response> {
  const guard = await requireAdmin()
  if (guard.error) return guard.error

  const rows = await getDb().select().from(overlayReleases).orderBy(desc(overlayReleases.releasedAt))

  return json({
    items: rows.map((row) => ({
      id: row.id,
      version: row.version,
      url: row.url,
      sha256: row.sha256,
      sizeBytes: row.sizeBytes,
      minClientVersion: row.minClientVersion,
      notes: row.notes,
      isCurrent: row.isCurrent,
      releasedAt: row.releasedAt.toISOString()
    }))
  })
}

export async function POST(request: Request): Promise<Response> {
  const guard = await requireAdmin()
  if (guard.error) return guard.error

  /*
   * Multipart plutôt que JSON : le bundle est binaire, et le encoder en base64
   * gonflerait la requête d'un tiers pour rien.
   */
  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return fail(415, 'expected_multipart', 'Envoyez un formulaire multipart avec le champ bundle.')
  }

  const version = form.get('version')
  if (typeof version !== 'string' || version.trim() === '') {
    return fail(422, 'missing_version', 'Le champ version est obligatoire.')
  }

  const file = form.get('bundle')
  if (!(file instanceof File) || file.size === 0) {
    return fail(422, 'missing_bundle', "Le champ bundle doit porter l'archive zip.")
  }

  const minClientVersion = form.get('minClientVersion')
  const notes = form.get('notes')

  const outcome = await publishRelease({
    version: version.trim(),
    bundle: Buffer.from(await file.arrayBuffer()),
    minClientVersion: typeof minClientVersion === 'string' ? minClientVersion : undefined,
    notes: typeof notes === 'string' ? notes : undefined
  })

  if (!outcome.ok) return fail(STATUS[outcome.code] ?? 400, outcome.code, outcome.message)
  return json({ version: outcome.version }, { status: 201 })
}
