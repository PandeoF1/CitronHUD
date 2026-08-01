import { z } from 'zod'

/**
 * Identifiants et primitives partagées.
 */

export const idSchema = z.string().min(1).max(64)
export type Id = z.infer<typeof idSchema>

/**
 * SteamID64.
 *
 * Toujours transporté en chaîne, jamais en nombre : 76561198000000000 dépasse
 * `Number.MAX_SAFE_INTEGER`, et un JSON.parse silencieux corromprait les
 * derniers chiffres — donc l'identité du joueur.
 *
 * Les comptes individuels commencent par 7656119 ; un bot ou un joueur non
 * authentifié renvoie parfois "BOT" ou une chaîne vide côté GSI, filtrés en
 * amont par le moteur.
 */
export const steamId64Schema = z
  .string()
  .regex(/^7656119\d{10}$/, 'SteamID64 attendu (17 chiffres commençant par 7656119)')
export type SteamId64 = z.infer<typeof steamId64Schema>

/** Vrai si la chaîne est un SteamID64 individuel exploitable. */
export function isSteamId64(value: unknown): value is SteamId64 {
  return typeof value === 'string' && /^7656119\d{10}$/.test(value)
}

/** Code pays ISO 3166-1 alpha-2, en majuscules. */
export const countrySchema = z
  .string()
  .length(2)
  .regex(/^[A-Z]{2}$/, 'Code pays ISO alpha-2 attendu (ex. FR)')

/**
 * Couleur hexadécimale.
 *
 * Sert aux surcharges de couleur d'équipe, saisies à la main dans l'admin :
 * on accepte les deux notations mais on normalise en 6 chiffres pour que le
 * canvas et le CSS reçoivent toujours la même forme.
 */
export const hexColorSchema = z
  .string()
  .regex(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, 'Couleur hexadécimale attendue (#RGB ou #RRGGBB)')
  .transform((value) => {
    if (value.length === 4) {
      const [, r, g, b] = value
      return `#${r}${r}${g}${g}${b}${b}`.toLowerCase()
    }
    return value.toLowerCase()
  })

/** Horodatage ISO 8601 en UTC. */
export const isoDateSchema = z.iso.datetime()

/** Métadonnées d'audit communes aux entités persistées côté serveur. */
export const auditSchema = z.object({
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema
})

export const paginationQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().optional()
})
export type PaginationQuery = z.infer<typeof paginationQuerySchema>

export function paginatedSchema<T extends z.ZodTypeAny>(item: T) {
  return z.object({
    items: z.array(item),
    nextCursor: z.string().nullable()
  })
}

/** Enveloppe d'erreur uniforme de l'API. */
export const apiErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional()
  })
})
export type ApiError = z.infer<typeof apiErrorSchema>

/** Les deux camps de CS2. */
export const sideSchema = z.enum(['CT', 'T'])
export type Side = z.infer<typeof sideSchema>

/** Position à l'écran d'une équipe, indépendante de son camp en jeu. */
export const slotSchema = z.enum(['left', 'right'])
export type Slot = z.infer<typeof slotSchema>
