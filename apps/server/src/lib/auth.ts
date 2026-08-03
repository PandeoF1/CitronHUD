import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { headers } from 'next/headers'
import { getDb, schema } from '../db'
import { authSecret, publicUrl } from './env'

/**
 * Authentification de l'interface d'administration.
 *
 * Mot de passe uniquement, et **inscription fermée** : les comptes sont créés
 * par `pnpm db:seed` ou depuis l'admin. Un serveur d'orga est un point exposé
 * sur Internet ; laisser l'inscription ouverte donnerait à n'importe qui accès
 * au roster et à l'historique de la structure.
 *
 * Cette authentification ne concerne que l'admin. Les clients Electron passent
 * par une clé d'API — voir `api-key.ts`.
 */

/*
 * Le type de `betterAuth` dépend des options passées — l'annoter à la main avec
 * `ReturnType<typeof betterAuth>` efface cette dépendance et fait perdre
 * `$context`, dont le seed a besoin pour hacher un mot de passe. On laisse donc
 * l'inférence traverser cette fabrique.
 */
function build() {
  return betterAuth({
    database: drizzleAdapter(getDb(), { provider: 'pg', schema }),
    secret: authSecret(),
    baseURL: publicUrl(),
    emailAndPassword: {
      enabled: true,
      disableSignUp: true,
      minPasswordLength: 10
    },
    session: {
      // Une régie travaille par journées entières ; une semaine évite de se
      // reconnecter au milieu d'un tournoi sans pour autant durer un mois.
      expiresIn: 60 * 60 * 24 * 7,
      updateAge: 60 * 60 * 24
    }
  })
}

let instance: ReturnType<typeof build> | null = null

export function getAuth(): ReturnType<typeof build> {
  return (instance ??= build())
}

export interface AdminUser {
  id: string
  name: string
  email: string
}

/** L'administrateur connecté, ou `null`. */
export async function currentUser(): Promise<AdminUser | null> {
  const result = await getAuth().api.getSession({ headers: await headers() })
  if (!result?.user) return null
  const { id, name, email } = result.user
  return { id, name, email }
}
