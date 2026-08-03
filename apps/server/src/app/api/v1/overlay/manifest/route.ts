import { desc, eq } from 'drizzle-orm'
import { getDb } from '../../../../../db'
import { overlayReleases } from '../../../../../db/schema'
import { requireClient } from '../../../../../lib/guard'
import { json, notFound } from '../../../../../lib/http'

/**
 * La version d'overlay que les clients doivent servir.
 *
 * L'overlay se met à jour indépendamment du binaire du client : corriger une
 * couleur ou un décalage ne doit pas obliger une orga à réinstaller un `.exe`
 * la veille d'un tournoi.
 *
 * Un 404 est une réponse normale — il signifie « aucune version publiée » — et
 * le client garde alors le bundle avec lequel il a été installé.
 */
export async function GET(request: Request): Promise<Response> {
  const guard = await requireClient(request)
  if (guard.error) return guard.error

  const [row] = await getDb()
    .select()
    .from(overlayReleases)
    .where(eq(overlayReleases.isCurrent, true))
    .orderBy(desc(overlayReleases.releasedAt))
    .limit(1)

  if (!row) return notFound("Aucune version d'overlay publiée.")

  return json({
    version: row.version,
    url: row.url,
    sha256: row.sha256,
    sizeBytes: row.sizeBytes,
    minClientVersion: row.minClientVersion,
    releasedAt: row.releasedAt.toISOString(),
    notes: row.notes
  })
}
