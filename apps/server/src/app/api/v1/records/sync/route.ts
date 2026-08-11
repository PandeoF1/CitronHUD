import { requireClient } from '../../../../../lib/guard'
import { fail, json } from '../../../../../lib/http'
import { candidatesFrom, syncRecords } from '../../../../../lib/records'

/**
 * Synchronisation des records.
 *
 * Le corps n'est pas validé par un schéma unique : le contrat décrit une
 * enveloppe `{ sessionId, candidates[] }` alors que la file d'envoi du client
 * poste un évènement de record isolé. `candidatesFrom` absorbe les deux — voir
 * `lib/records.ts` pour le détail et la raison.
 *
 * L'arbitrage est fait ici, jamais par le client : c'est ce qui empêche une
 * machine à l'heure fausse ou une version antérieure du moteur d'inscrire un
 * record que personne n'a réalisé.
 */
export async function POST(request: Request): Promise<Response> {
  const guard = await requireClient(request)
  if (guard.error) return guard.error

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return fail(400, 'invalid_json', 'Corps de requête JSON illisible.')
  }

  const { candidates, unusable } = candidatesFrom(body)
  if (candidates.length === 0) {
    return fail(422, 'no_candidates', 'Aucun candidat exploitable dans la requête.')
  }

  const outcome = await syncRecords(candidates)

  /*
   * Les candidats illisibles sont signalés au lieu d'être passés sous silence.
   * Le cas typique est un client plus récent que le serveur qui envoie une
   * métrique inconnue : sans cette ligne, le record semble parti et personne ne
   * sait pourquoi il n'apparaît nulle part.
   */
  if (unusable > 0) {
    outcome.rejected.push({
      metric: null,
      steamId: null,
      reason: `${unusable} candidat(s) illisibles : métrique ou portée inconnue de ce serveur.`
    })
  }

  return json(outcome)
}
