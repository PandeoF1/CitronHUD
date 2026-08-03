import { createHash, timingSafeEqual } from 'node:crypto'
import { and, eq, isNull } from 'drizzle-orm'
import { API_KEY_HEADER, CLIENT_VERSION_HEADER } from '@citronhud/contracts'
import { getDb } from '../db'
import { apiKeys } from '../db/schema'

/**
 * Authentification des clients Electron.
 *
 * Le modèle de droits tient en une phrase : **une clé lit le roster et rapporte
 * ce qui s'est passé ; elle ne modifie jamais le roster.** Les clés vivent sur
 * les machines des streamers, souvent partagées et rarement mises à jour — une
 * clé volée ne doit pas permettre d'effacer les équipes de la structure. Toute
 * modification éditoriale passe par une session d'administration.
 */

export function hashApiKey(key: string): string {
  return createHash('sha256').update(key).digest('hex')
}

export interface ClientIdentity {
  keyId: string
  label: string
  /** Version annoncée par le client, pour les diagnostics. */
  clientVersion: string | null
}

/**
 * Vérifie l'en-tête `x-citron-key`.
 *
 * La comparaison se fait sur le haché, en temps constant : comparer deux
 * chaînes avec `===` s'arrête au premier caractère différent, ce qui laisse
 * fuir la clé caractère par caractère à qui mesure les temps de réponse.
 */
export async function authenticateClient(request: Request): Promise<ClientIdentity | null> {
  const presented = request.headers.get(API_KEY_HEADER)
  if (!presented) return null

  const digest = hashApiKey(presented)
  const rows = await getDb()
    .select()
    .from(apiKeys)
    .where(and(eq(apiKeys.hash, digest), isNull(apiKeys.revokedAt)))
    .limit(1)

  const row = rows[0]
  if (!row) return null

  const expected = Buffer.from(row.hash, 'hex')
  const actual = Buffer.from(digest, 'hex')
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null

  /*
   * L'horodatage d'usage n'est pas attendu par l'appelant : une écriture ratée
   * ne doit pas faire échouer une requête par ailleurs valide. C'est un confort
   * de diagnostic — « cette régie a-t-elle synchronisé aujourd'hui ? » — pas
   * une donnée dont dépend le service.
   */
  void getDb()
    .update(apiKeys)
    .set({ lastUsedAt: new Date() })
    .where(eq(apiKeys.id, row.id))
    .catch(() => undefined)

  return {
    keyId: row.id,
    label: row.label,
    clientVersion: request.headers.get(CLIENT_VERSION_HEADER)
  }
}

/**
 * Vrai si aucune clé n'existe encore.
 *
 * Un serveur fraîchement déployé n'a pas de clé : refuser toutes les requêtes
 * serait correct mais laisserait l'installateur face à un 401 opaque. On
 * accepte alors les clients anonymes, et l'admin affiche un avertissement bien
 * visible tant que la première clé n'est pas créée.
 */
export async function isUnclaimed(): Promise<boolean> {
  const rows = await getDb().select({ id: apiKeys.id }).from(apiKeys).limit(1)
  return rows.length === 0
}
