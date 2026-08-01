import { z } from 'zod'
import { auditSchema, countrySchema, hexColorSchema, idSchema, steamId64Schema } from './common'

/**
 * Le roster — équipes et joueurs administrés côté serveur.
 *
 * C'est la donnée que le streamer n'a PAS à saisir : photos, pseudos, pays et
 * appartenances sont maintenus une fois pour toutes dans l'interface admin,
 * puis synchronisés vers chaque client. Le client garde toujours une copie
 * locale, donc un serveur injoignable ne bloque jamais une diffusion.
 */

export const playerRoleSchema = z.enum(['igl', 'awper', 'entry', 'support', 'lurker', 'rifler'])
export type PlayerRole = z.infer<typeof playerRoleSchema>

export const teamSchema = auditSchema.extend({
  id: idSchema,
  /** Identifiant lisible et stable, utilisé dans les URL de l'admin. */
  slug: z
    .string()
    .min(2)
    .max(48)
    .regex(/^[a-z0-9-]+$/, 'Minuscules, chiffres et tirets uniquement'),
  name: z.string().min(1).max(64),
  /**
   * Nom court affiché dans la matchbar.
   *
   * Plafonné à 6 caractères : au-delà, la typo condensée du scoreboard casse
   * la mise en page à 1080p. L'admin doit trancher, pas le HUD.
   */
  shortName: z.string().min(1).max(6),
  country: countrySchema.nullable(),
  logoUrl: z.url().nullable(),
  /** Surcharge facultative de la couleur d'équipe (sinon couleur du camp). */
  color: hexColorSchema.nullable(),
  createdBy: idSchema.nullable()
})
export type Team = z.infer<typeof teamSchema>

export const createTeamSchema = teamSchema
  .omit({ id: true, createdAt: true, updatedAt: true, createdBy: true })
  .extend({
    country: countrySchema.nullable().default(null),
    logoUrl: z.url().nullable().default(null),
    color: hexColorSchema.nullable().default(null)
  })
export type CreateTeam = z.infer<typeof createTeamSchema>
export const updateTeamSchema = createTeamSchema.partial()
export type UpdateTeam = z.infer<typeof updateTeamSchema>

export const playerSchema = auditSchema.extend({
  id: idSchema,
  /** Clé de rattachement au GSI : c'est par là que le HUD reconnaît un joueur. */
  steamId: steamId64Schema,
  /** Pseudo affiché. Prime toujours sur le nom renvoyé par le jeu. */
  nickname: z.string().min(1).max(32),
  firstName: z.string().max(48).nullable(),
  lastName: z.string().max(48).nullable(),
  country: countrySchema.nullable(),
  /** La « pp » du joueur, servie depuis le stockage objet. */
  avatarUrl: z.url().nullable(),
  teamId: idSchema.nullable(),
  role: playerRoleSchema.nullable(),
  /**
   * Un coach occupe un slot d'observateur en jeu mais ne doit apparaître ni
   * dans le scoreboard ni dans les listes. Le moteur le retire du flux avant
   * même que l'overlay ne le voie.
   */
  isCoach: z.boolean().default(false),
  /** Handles réseaux, affichés sur le lower-third du joueur observé. */
  socials: z
    .object({
      twitch: z.string().max(64).nullable().default(null),
      x: z.string().max(64).nullable().default(null),
      instagram: z.string().max(64).nullable().default(null)
    })
    .partial()
    .nullable()
})
export type Player = z.infer<typeof playerSchema>

export const createPlayerSchema = playerSchema
  .omit({ id: true, createdAt: true, updatedAt: true })
  .extend({
    firstName: z.string().max(48).nullable().default(null),
    lastName: z.string().max(48).nullable().default(null),
    country: countrySchema.nullable().default(null),
    avatarUrl: z.url().nullable().default(null),
    teamId: idSchema.nullable().default(null),
    role: playerRoleSchema.nullable().default(null),
    socials: z.any().nullable().default(null)
  })
export type CreatePlayer = z.infer<typeof createPlayerSchema>
export const updatePlayerSchema = createPlayerSchema.partial()
export type UpdatePlayer = z.infer<typeof updatePlayerSchema>

/**
 * Instantané complet du roster.
 *
 * `version` est un hash du contenu : le client l'envoie en `If-None-Match` et
 * le serveur répond 304 si rien n'a bougé. Sur une connexion de LAN partagée,
 * ça évite de retélécharger tout le roster toutes les cinq minutes.
 */
export const rosterSnapshotSchema = z.object({
  version: z.string(),
  fetchedAt: z.iso.datetime(),
  teams: z.array(teamSchema),
  players: z.array(playerSchema)
})
export type RosterSnapshot = z.infer<typeof rosterSnapshotSchema>

/** Joueur résolu : ce que l'overlay reçoit réellement. */
export const resolvedPlayerSchema = z.object({
  steamId: z.string(),
  /** Pseudo du roster si connu, sinon le nom renvoyé par le jeu. */
  name: z.string(),
  realName: z.string().nullable(),
  country: z.string().nullable(),
  avatarUrl: z.string().nullable(),
  role: playerRoleSchema.nullable(),
  teamId: z.string().nullable(),
  /** Faux quand le joueur n'existe pas au roster : le HUD affiche un état neutre. */
  known: z.boolean()
})
export type ResolvedPlayer = z.infer<typeof resolvedPlayerSchema>
