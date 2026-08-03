import { migrate } from 'drizzle-orm/postgres-js/migrator'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'

/**
 * Applique les migrations.
 *
 * Une connexion dédiée avec `max: 1` : le verrou de migration de Drizzle vaut
 * pour une connexion, et un pool en laisserait plusieurs tenter les mêmes
 * instructions en parallèle au démarrage d'un conteneur.
 */
const url = process.env.DATABASE_URL
if (!url) {
  console.error("DATABASE_URL manquante. Voir apps/server/.env.example.")
  process.exit(1)
}

const sql = postgres(url, { max: 1 })

try {
  await migrate(drizzle(sql), { migrationsFolder: './drizzle' })
  console.log('Migrations appliquées.')
} catch (error) {
  console.error('Échec des migrations :', (error as Error).message)
  process.exitCode = 1
} finally {
  await sql.end()
}
