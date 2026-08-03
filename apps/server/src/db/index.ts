import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { databaseUrl } from '../lib/env'
import * as schema from './schema'

/**
 * Connexion à PostgreSQL.
 *
 * Ouverte à la première requête, pas à l'import : `next build` charge chaque
 * route pour l'analyser, et une connexion tentée à ce moment-là ferait échouer
 * la construction de l'image Docker faute de base accessible.
 *
 * Le client est mémorisé sur `globalThis` parce que le rechargement à chaud de
 * Next réévalue les modules à chaque édition : sans cela, une session de
 * développement d'une heure laisse derrière elle des dizaines de pools ouverts
 * et finit par épuiser `max_connections`.
 */

const globalForDb = globalThis as unknown as {
  citronSql?: ReturnType<typeof postgres>
  citronDb?: ReturnType<typeof create>
}

function create() {
  const sql =
    globalForDb.citronSql ??
    postgres(databaseUrl(), {
      /*
       * Réglable : dix connexions conviennent à un serveur d'orga, mais un
       * PgBouncer en mode transaction ou un PostgreSQL embarqué de test veut
       * parfois une seule connexion, et cette contrainte-là vient du
       * déploiement, pas du code.
       */
      max: Number(process.env.DATABASE_POOL_MAX ?? 10),
      // Les objets `Date` de Postgres traversent tels quels ; on ne convertit
      // qu'au moment de sérialiser, dans les `toApi*`.
      prepare: false
    })
  if (process.env.NODE_ENV !== 'production') globalForDb.citronSql = sql

  return drizzle(sql, { schema, casing: 'snake_case' })
}

export function getDb(): ReturnType<typeof create> {
  globalForDb.citronDb ??= create()
  return globalForDb.citronDb
}

export { schema }
