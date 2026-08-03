import { eq } from 'drizzle-orm'
import { getDb } from './index'
import { account, apiKeys, user } from './schema'
import { getAuth } from '../lib/auth'
import { hashApiKey } from '../lib/api-key'
import { newApiKey, newId } from '../lib/ids'

/**
 * Amorçage d'une installation neuve.
 *
 * Crée le premier administrateur et la première clé d'API — les deux choses
 * sans lesquelles un serveur fraîchement déployé n'est utilisable par personne.
 * Idempotent : relancé, il ne recrée rien et se contente de le dire.
 *
 * Le mot de passe est haché par better-auth lui-même plutôt que par nous :
 * l'algorithme et ses paramètres appartiennent à la bibliothèque, et les
 * reproduire à la main garantit qu'ils divergeront à la première mise à jour.
 */

const email = process.env.SEED_ADMIN_EMAIL ?? 'admin@citron.gg'
const password = process.env.SEED_ADMIN_PASSWORD

if (!password || password.length < 10) {
  console.error(
    'SEED_ADMIN_PASSWORD manquant ou trop court (10 caractères minimum).\n' +
      'Exemple :  SEED_ADMIN_PASSWORD="…" pnpm db:seed'
  )
  process.exit(1)
}

const db = getDb()

const [existing] = await db.select().from(user).where(eq(user.email, email))

if (existing) {
  console.log(`Administrateur « ${email} » déjà présent.`)
} else {
  const context = await getAuth().$context
  const userId = newId()

  await db.insert(user).values({
    id: userId,
    name: 'Administrateur',
    email,
    emailVerified: true
  })

  await db.insert(account).values({
    id: newId(),
    accountId: userId,
    providerId: 'credential',
    userId,
    password: await context.password.hash(password)
  })

  console.log(`Administrateur créé : ${email}`)
}

const keys = await db.select({ id: apiKeys.id }).from(apiKeys).limit(1)

if (keys.length > 0) {
  console.log("Au moins une clé d'API existe déjà — aucune nouvelle clé créée.")
} else {
  const key = newApiKey()
  await db.insert(apiKeys).values({
    id: newId(),
    label: 'Première régie',
    hash: hashApiKey(key),
    prefix: key.slice(0, 14)
  })

  // Seule occasion où la clé apparaît en clair : seul son haché est stocké.
  console.log(`\nClé d'API (à copier maintenant, elle ne sera plus affichée) :\n  ${key}\n`)
}

process.exit(0)
