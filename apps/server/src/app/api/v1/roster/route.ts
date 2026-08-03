import { NextResponse } from 'next/server'
import { requireClient } from '../../../../lib/guard'
import { json } from '../../../../lib/http'
import { rosterSnapshot } from '../../../../lib/roster'

/**
 * Le roster complet.
 *
 * Le client envoie l'empreinte qu'il détient ; si elle correspond, on répond
 * 304 sans corps. Sur un réseau de LAN partagé entre plusieurs régies, cela
 * évite de retransférer le même roster toutes les cinq minutes par machine.
 *
 * L'empreinte est aussi posée en `ETag`, pour que les caches intermédiaires
 * fassent le même travail sans rien savoir de notre paramètre `version`.
 */
export async function GET(request: Request): Promise<Response> {
  const { error } = await requireClient(request)
  if (error) return error

  const snapshot = await rosterSnapshot()
  const known =
    new URL(request.url).searchParams.get('version') ??
    request.headers.get('if-none-match')?.replace(/^"|"$/g, '')

  if (known && known === snapshot.version) {
    return new NextResponse(null, {
      status: 304,
      headers: { etag: `"${snapshot.version}"` }
    })
  }

  return json(snapshot, { headers: { etag: `"${snapshot.version}"` } })
}
