import { z } from 'zod'
import { hexColorSchema, idSchema, isoDateSchema, sideSchema, slotSchema } from './common'

/**
 * Configuration de match — l'unique chose que le streamer touche.
 *
 * Tout le reste (photos, pseudos, pays) vient du roster serveur. Ici on ne
 * choisit que : quelles équipes s'affrontent, dans quel format, et de quel côté
 * de l'écran chacune apparaît.
 */

/**
 * Une équipe engagée sur un slot d'écran.
 *
 * Trois provenances possibles, dans cet ordre de préférence :
 *  - `roster`  : l'équipe existe côté serveur, tout est déjà rempli ;
 *  - `adhoc`   : le streamer tape un nom à la volée (scrim, équipe inconnue,
 *                serveur injoignable) — c'est le filet de sécurité qui permet
 *                de diffuser même quand rien n'a été préparé ;
 *  - `unset`   : slot vide, le HUD affiche un placeholder neutre.
 */
export const teamSlotSchema = z.discriminatedUnion('source', [
  z.object({
    source: z.literal('roster'),
    teamId: idSchema
  }),
  z.object({
    source: z.literal('adhoc'),
    name: z.string().min(1).max(64),
    shortName: z.string().min(1).max(6),
    color: hexColorSchema.nullable().default(null),
    logoUrl: z.string().nullable().default(null)
  }),
  z.object({
    source: z.literal('unset')
  })
])
export type TeamSlot = z.infer<typeof teamSlotSchema>

/**
 * Affectation des camps.
 *
 * Le problème : l'écran a une gauche et une droite, le jeu a un CT et un T, et
 * les deux ne coïncident pas — ils s'inversent à la mi-temps, et une équipe
 * peut être mal reconnue si des SteamID manquent au roster.
 *
 * En mode `auto`, le camp est recalculé à chaque frame GSI en comptant les
 * joueurs identifiés par SteamID de chaque côté. La conséquence utile : la
 * mi-temps ne demande AUCUNE logique dédiée, puisque les joueurs changent
 * réellement de camp dans le flux et que la détection suit toute seule.
 *
 * En mode `manual`, l'opérateur fige l'affectation — il faut alors inverser à
 * la main à la mi-temps, ou réactiver `auto`.
 */
export const sideAssignmentSchema = z.object({
  mode: z.enum(['auto', 'manual']).default('auto'),
  /** Camp occupé par l'équipe affichée à gauche. */
  leftSide: sideSchema.default('CT'),
  /**
   * Fiabilité de la détection automatique, de 0 à 1.
   *
   * Sous 0.6, le client affiche un avertissement : c'est le signal qu'il manque
   * des SteamID au roster et que l'opérateur devrait vérifier avant de lancer.
   */
  confidence: z.number().min(0).max(1).default(0),
  /** Nombre de joueurs en jeu effectivement reconnus au roster. */
  matchedPlayers: z.number().int().min(0).default(0),
  /** Vrai si l'opérateur a inversé manuellement depuis le dernier calcul auto. */
  overridden: z.boolean().default(false),
  updatedAt: isoDateSchema.nullable().default(null)
})
export type SideAssignment = z.infer<typeof sideAssignmentSchema>

export const matchFormatSchema = z.enum(['bo1', 'bo3', 'bo5'])
export type MatchFormat = z.infer<typeof matchFormatSchema>

export const vetoSchema = z.object({
  mapName: z.string(),
  type: z.enum(['ban', 'pick', 'decider']),
  /** Slot ayant effectué l'action ; null pour un decider. */
  by: slotSchema.nullable(),
  /** Camp choisi en début de map par l'équipe adverse du picker. */
  startingSide: sideSchema.nullable().default(null),
  played: z.boolean().default(false),
  score: z
    .object({
      left: z.number().int().min(0),
      right: z.number().int().min(0)
    })
    .nullable()
    .default(null),
  winner: slotSchema.nullable().default(null)
})
export type Veto = z.infer<typeof vetoSchema>

export const matchSetupSchema = z.object({
  id: idSchema,
  format: matchFormatSchema.default('bo1'),
  left: teamSlotSchema,
  right: teamSlotSchema,
  sides: sideAssignmentSchema,
  /** Score de série (maps gagnées), indépendant du score de la map en cours. */
  seriesScore: z
    .object({
      left: z.number().int().min(0).default(0),
      right: z.number().int().min(0).default(0)
    })
    .default({ left: 0, right: 0 }),
  vetos: z.array(vetoSchema).default([]),
  /** Contexte affiché en haut du HUD. */
  event: z
    .object({
      name: z.string().max(64).default(''),
      stage: z.string().max(64).default('')
    })
    .default({ name: '', stage: '' }),
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema
})
export type MatchSetup = z.infer<typeof matchSetupSchema>

export const createMatchSetupSchema = matchSetupSchema
  .omit({ id: true, createdAt: true, updatedAt: true })
  .partial({ sides: true, seriesScore: true, vetos: true, event: true, format: true })
export type CreateMatchSetup = z.infer<typeof createMatchSetupSchema>

/**
 * Équipe résolue, prête à l'affichage.
 *
 * Le client fusionne le slot (roster ou ad hoc) avec l'état GSI courant pour
 * que l'overlay n'ait plus aucune décision à prendre : il dessine ce qu'on lui
 * donne. Toute la logique d'identité reste côté client, testable.
 */
export const resolvedTeamSchema = z.object({
  slot: slotSchema,
  side: sideSchema,
  name: z.string(),
  shortName: z.string(),
  logoUrl: z.string().nullable(),
  color: z.string().nullable(),
  country: z.string().nullable(),
  teamId: z.string().nullable(),
  score: z.number().int().min(0),
  seriesWins: z.number().int().min(0),
  /** Manches consécutives perdues, pour l'indicateur de série. */
  lossBonus: z.number().int().min(0).max(4).default(0),
  timeoutsRemaining: z.number().int().min(0).default(4),
  matchPoint: z.boolean().default(false)
})
export type ResolvedTeam = z.infer<typeof resolvedTeamSchema>
