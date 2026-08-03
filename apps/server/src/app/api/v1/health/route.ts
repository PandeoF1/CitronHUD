import { SERVER_VERSION } from '../../../../lib/env'
import { requireClient } from '../../../../lib/guard'
import { json } from '../../../../lib/http'

/**
 * Sonde de vie, également utilisée par le bouton « Tester » du client.
 *
 * Protégée par la clé d'API : le client teste *sa* liaison, clé comprise. Une
 * route ouverte répondrait « serveur joignable » à un client dont la clé est
 * refusée, ce qui enverrait le streamer chercher la panne du mauvais côté.
 */
export async function GET(request: Request): Promise<Response> {
  const { error } = await requireClient(request)
  if (error) return error

  return json({ ok: true as const, version: SERVER_VERSION, time: new Date().toISOString() })
}
