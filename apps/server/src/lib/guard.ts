import type { NextResponse } from 'next/server'
import { authenticateClient, isUnclaimed, type ClientIdentity } from './api-key'
import { currentUser, type AdminUser } from './auth'
import { forbidden, unauthorized } from './http'

/**
 * Gardes d'accès.
 *
 * Deux publics distincts, deux mécanismes : les clients Electron présentent une
 * clé d'API, les administrateurs une session de navigateur. Les deux ne donnent
 * pas les mêmes droits — voir `api-key.ts` pour le raisonnement.
 */

export type Guarded<T> = { actor: T; error: null } | { actor: null; error: NextResponse }

/**
 * Accès client : lecture du roster, remontée d'activité.
 *
 * Une session d'administration est acceptée à la place d'une clé, pour que
 * l'admin puisse appeler ses propres routes depuis le navigateur — sinon il
 * faudrait y coller une clé, c'est-à-dire l'exposer dans une page web.
 */
export async function requireClient(request: Request): Promise<Guarded<ClientIdentity>> {
  const client = await authenticateClient(request)
  if (client) return { actor: client, error: null }

  const admin = await currentUser()
  if (admin) {
    return { actor: { keyId: admin.id, label: admin.email, clientVersion: null }, error: null }
  }

  /*
   * Serveur tout juste déployé, aucune clé créée : on laisse passer plutôt que
   * de renvoyer un 401 impossible à diagnostiquer depuis la machine du
   * streamer. L'admin affiche un avertissement tant que cet état dure.
   */
  if (await isUnclaimed()) {
    return { actor: { keyId: 'anonymous', label: 'sans clé', clientVersion: null }, error: null }
  }

  return { actor: null, error: unauthorized() }
}

/** Accès administrateur : toute modification éditoriale du roster. */
export async function requireAdmin(): Promise<Guarded<AdminUser>> {
  const admin = await currentUser()
  if (!admin) {
    return { actor: null, error: forbidden('Session administrateur requise.') }
  }
  return { actor: admin, error: null }
}
