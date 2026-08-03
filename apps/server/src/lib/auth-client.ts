'use client'

import { createAuthClient } from 'better-auth/react'

/**
 * Client d'authentification du navigateur.
 *
 * Sans `baseURL` : les appels partent en relatif vers l'origine servie, ce qui
 * fonctionne aussi bien en développement sur `localhost` que derrière le
 * domaine de production, sans variable d'environnement exposée au client.
 */
export const authClient = createAuthClient()
