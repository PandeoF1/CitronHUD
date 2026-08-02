import { z } from 'zod'
import { sideSchema, slotSchema } from './common'
import { resolvedTeamSchema } from './match'
import { playerRoleSchema } from './roster'

/**
 * L'état HUD — le contrat unique entre le client et l'overlay.
 *
 * Tout est déjà résolu ici : identités fusionnées avec le roster, camps
 * attribués, scores orientés gauche/droite. L'overlay ne prend AUCUNE décision
 * métier, il dessine. Toute la logique reste côté client, où elle est testable
 * sans navigateur.
 */

export const weaponStateSchema = z.enum(['active', 'holstered', 'reloading'])

export const weaponSchema = z.object({
  /** Nom technique, ex. « weapon_ak47 ». */
  name: z.string(),
  /** Libellé lisible, ex. « AK-47 ». */
  label: z.string(),
  type: z.string().nullable(),
  state: weaponStateSchema,
  ammoClip: z.number().int().nullable(),
  ammoClipMax: z.number().int().nullable(),
  ammoReserve: z.number().int().nullable()
})
export type Weapon = z.infer<typeof weaponSchema>

export const playerStatsSchema = z.object({
  kills: z.number().int(),
  assists: z.number().int(),
  deaths: z.number().int(),
  mvps: z.number().int(),
  score: z.number().int(),
  /**
   * Dégâts moyens par manche.
   *
   * Cumulés par le client depuis les dégâts par manche : le GSI ne fournit pas
   * l'ADR, et les HUDs qui l'affichent le reconstruisent tous ainsi.
   */
  adr: z.number(),
  headshotKills: z.number().int(),
  headshotPercent: z.number(),
  kd: z.number()
})
export type PlayerStats = z.infer<typeof playerStatsSchema>

export const hudPlayerSchema = z.object({
  steamId: z.string(),
  name: z.string(),
  realName: z.string().nullable(),
  country: z.string().nullable(),
  avatarUrl: z.string().nullable(),
  role: playerRoleSchema.nullable(),
  /** Faux quand le SteamID est absent du roster : le HUD dégrade proprement. */
  known: z.boolean(),

  slot: slotSchema,
  side: sideSchema,
  observerSlot: z.number().int().min(0).max(10),

  alive: z.boolean(),
  health: z.number().int().min(0).max(100),
  armor: z.number().int().min(0).max(100),
  helmet: z.boolean(),
  defuseKit: z.boolean(),
  /** 0 à 255 : opacité de l'aveuglement au moment de la frame. */
  flashed: z.number().int().min(0).max(255),
  burning: z.number().int().min(0).max(255),
  money: z.number().int().min(0),
  equipmentValue: z.number().int().min(0),

  weapons: z.array(weaponSchema),
  /** Utilitaires en main, dédupliqués et ordonnés pour l'affichage. */
  grenades: z.array(z.object({ name: z.string(), label: z.string(), count: z.number().int() })),

  stats: playerStatsSchema,
  roundKills: z.number().int(),
  roundHeadshots: z.number().int(),
  roundDamage: z.number().int(),

  position: z.tuple([z.number(), z.number(), z.number()]).nullable(),
  forward: z.tuple([z.number(), z.number(), z.number()]).nullable(),

  isObserved: z.boolean()
})
export type HudPlayer = z.infer<typeof hudPlayerSchema>

export const bombStateSchema = z.enum([
  'carried',
  'dropped',
  'planting',
  'planted',
  'defusing',
  'defused',
  'exploded'
])

export const bombSchema = z.object({
  state: bombStateSchema,
  /** Secondes restantes avant explosion, null hors phase posée. */
  countdown: z.number().nullable(),
  site: z.enum(['A', 'B']).nullable(),
  /** Porteur ou désamorceur selon l'état. */
  playerSteamId: z.string().nullable(),
  position: z.tuple([z.number(), z.number(), z.number()]).nullable(),
  /**
   * Vrai quand le désamorçage ne peut pas aboutir avant l'explosion.
   *
   * C'est l'information la plus tendue du jeu et aucun HUD gratuit ne l'affiche
   * correctement : on compare le temps de désamorçage restant au compte à
   * rebours plutôt que de laisser le spectateur faire le calcul.
   */
  defuseTooLate: z.boolean().default(false)
})
export type Bomb = z.infer<typeof bombSchema>

export const roundPhaseSchema = z.enum([
  'warmup',
  'freezetime',
  'live',
  'over',
  'intermission',
  'timeout',
  'gameover',
  'unknown'
])

export const mapStateSchema = z.object({
  name: z.string(),
  /** Nom d'affichage, ex. « Mirage » plutôt que « de_mirage ». */
  label: z.string(),
  mode: z.string(),
  phase: roundPhaseSchema,
  round: z.number().int().min(0),
  /** Secondes restantes dans la phase courante, null si inconnu. */
  phaseEndsIn: z.number().nullable(),
  /** Résultats de manche indexés par numéro, pour la frise de manches. */
  roundWins: z.record(z.string(), z.string()).default({}),
  /** Vrai en prolongation. */
  overtime: z.boolean().default(false),
  /** Manches à gagner en temps réglementaire (MR12 en CS2 par défaut). */
  regulationMR: z.number().int().default(12),
  overtimeMR: z.number().int().default(3)
})
export type MapState = z.infer<typeof mapStateSchema>

/**
 * Évènement de kill reconstruit.
 *
 * Le GSI de CS2 ne fournit AUCUN killfeed. Le moteur le reconstruit en
 * comparant deux frames consécutives : compteur de kills qui monte d'un côté,
 * santé qui tombe à zéro de l'autre. Les champs présents ici sont exactement
 * ceux qu'on peut déduire honnêtement — pas de wallbang ni de noscope, que le
 * flux ne permet pas de connaître.
 */
export const killEventSchema = z.object({
  id: z.string(),
  at: z.number(),
  round: z.number().int(),
  killer: z
    .object({
      steamId: z.string(),
      name: z.string(),
      side: sideSchema,
      slot: slotSchema
    })
    .nullable(),
  victim: z.object({
    steamId: z.string(),
    name: z.string(),
    side: sideSchema,
    slot: slotSchema
  }),
  assister: z
    .object({
      steamId: z.string(),
      name: z.string(),
      side: sideSchema
    })
    .nullable(),
  /** Arme active du tueur sur la frame du kill. */
  weapon: z.string().nullable(),
  weaponLabel: z.string().nullable(),
  headshot: z.boolean(),
  teamkill: z.boolean(),
  suicide: z.boolean()
})
export type KillEvent = z.infer<typeof killEventSchema>

/**
 * Un utilitaire visible sur le radar.
 *
 * Disponible seulement si `allgrenades "1"` figure dans le fichier GSI et si le
 * flux vient d'un spectateur. Le champ reste un tableau vide sinon : l'overlay
 * n'a pas à distinguer « pas d'utilitaire en l'air » de « bloc absent ».
 */
export const hudGrenadeSchema = z.object({
  id: z.string(),
  type: z.enum(['smoke', 'flash', 'frag', 'decoy', 'incendiary']),
  ownerSteamId: z.string().nullable(),
  /** Camp du lanceur, pour colorer la traînée. Null si le lanceur est inconnu. */
  side: sideSchema.nullable(),
  position: z.tuple([z.number(), z.number(), z.number()]).nullable(),
  /** Vrai quand l'effet occupe le terrain : fumée déployée, nappe qui brûle. */
  active: z.boolean(),
  /** Rayon de la zone en unités monde, 0 tant que le projectile vole. */
  radius: z.number(),
  /** Rayon d'un foyer incendiaire, en unités monde. */
  flameRadius: z.number(),
  flames: z.array(z.tuple([z.number(), z.number(), z.number()])),
  /** Positions successives depuis le lancer, les plus anciennes en tête. */
  trail: z.array(z.tuple([z.number(), z.number(), z.number()]))
})
export type HudGrenade = z.infer<typeof hudGrenadeSchema>

export const roundEndReasonSchema = z.enum([
  'elimination',
  'bomb',
  'defuse',
  'time',
  'rescue',
  'unknown'
])
export type RoundEndReason = z.infer<typeof roundEndReasonSchema>

/**
 * Bilan figé d'une manche.
 *
 * Capturé au passage en phase « over » plutôt que reconstruit à l'affichage :
 * les compteurs par manche du GSI repartent à zéro dès le temps de gel suivant,
 * et un bilan calculé trop tard serait vide.
 */
export const roundReviewSchema = z.object({
  round: z.number().int(),
  /** Camp vainqueur, et le côté d'écran correspondant. */
  winnerSide: sideSchema,
  winnerSlot: slotSchema,
  reason: roundEndReasonSchema,
  /** Score après la manche, orienté écran. */
  score: z.object({ left: z.number().int(), right: z.number().int() }),
  mvp: z
    .object({
      steamId: z.string(),
      name: z.string(),
      avatarUrl: z.string().nullable(),
      side: sideSchema,
      slot: slotSchema,
      kills: z.number().int(),
      headshots: z.number().int(),
      damage: z.number().int(),
      /** Phrase courte expliquant la sélection, ex. « 3 frags ». */
      reason: z.string()
    })
    .nullable(),
  /** Contribution de chaque joueur sur la seule manche écoulée. */
  players: z.array(
    z.object({
      steamId: z.string(),
      name: z.string(),
      avatarUrl: z.string().nullable(),
      side: sideSchema,
      slot: slotSchema,
      survived: z.boolean(),
      kills: z.number().int(),
      headshots: z.number().int(),
      damage: z.number().int(),
      /** Cumul de carte, pour le tableau complet. */
      totalKills: z.number().int(),
      totalAssists: z.number().int(),
      totalDeaths: z.number().int(),
      adr: z.number(),
      headshotPercent: z.number()
    })
  )
})
export type RoundReview = z.infer<typeof roundReviewSchema>

export const hudStateSchema = z.object({
  /** Faux quand aucune frame GSI n'est arrivée depuis le seuil de coupure. */
  live: z.boolean(),
  /** Horodatage de la dernière frame reçue. */
  updatedAt: z.number(),

  map: mapStateSchema.nullable(),
  phase: roundPhaseSchema,
  bomb: bombSchema.nullable(),

  teams: z.object({
    left: resolvedTeamSchema,
    right: resolvedTeamSchema
  }),
  players: z.array(hudPlayerSchema),
  observed: hudPlayerSchema.nullable(),
  killfeed: z.array(killEventSchema),
  grenades: z.array(hudGrenadeSchema).default([]),
  /** Bilan de la dernière manche, présent tant qu'il reste pertinent à l'écran. */
  roundReview: roundReviewSchema.nullable().default(null),

  event: z.object({
    name: z.string(),
    stage: z.string()
  }),

  series: z.object({
    format: z.enum(['bo1', 'bo3', 'bo5']),
    maps: z.array(
      z.object({
        mapName: z.string(),
        label: z.string(),
        played: z.boolean(),
        left: z.number().int().nullable(),
        right: z.number().int().nullable(),
        winner: slotSchema.nullable()
      })
    )
  }),

  /**
   * État de la détection des camps, remonté jusqu'à l'overlay.
   *
   * L'overlay ne l'affiche pas, mais le panneau de contrôle du client le
   * consomme depuis le même flux — une seule source de vérité pour les deux.
   */
  sides: z.object({
    mode: z.enum(['auto', 'manual']),
    leftSide: sideSchema,
    confidence: z.number(),
    matchedPlayers: z.number().int()
  })
})
export type HudState = z.infer<typeof hudStateSchema>
