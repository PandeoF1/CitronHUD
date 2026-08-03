import { defineConfig } from 'drizzle-kit'

/*
 * Next.js lit `.env` tout seul, mais drizzle-kit tourne hors de Next et ne lit
 * rien. Sans cette ligne, `db:studio` se rabat sur l'URL de repli ci-dessous et
 * ouvre silencieusement une autre base que celle de l'application — un écart
 * qu'on ne remarque qu'après avoir cherché une donnée qui « a disparu ».
 * En conteneur le fichier n'existe pas : les variables viennent de compose.
 */
try {
  process.loadEnvFile('.env')
} catch {
  // Fichier absent : cas normal en production.
}

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgres://citron:citron@localhost:5432/citronhud'
  },
  casing: 'snake_case'
})
