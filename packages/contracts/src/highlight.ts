import { z } from 'zod'
import { idSchema, isoDateSchema, sideSchema, slotSchema, steamId64Schema } from './common'

/**
 * Temps forts et replays.
 *
 * Un temps fort est détecté depuis le flux GSI, puis — si une capture est
 * disponible — associé à un clip vidéo que l'overlay rejoue à l'antenne.
 * La détection et la capture sont volontairement découplées : une orga qui ne
 * veut pas de replay garde quand même l'historique et les records.
 */

/**
 * Types de temps forts.
 *
 * Chaque type doit être déductible du seul flux GSI, sans killfeed natif. Ceux
 * qui ne le sont pas (noscope, wallbang, collateral) sont volontairement
 * absents : mieux vaut un catalogue honnête qu'une détection qui ment une fois
 * sur trois en direct.
 */
export const highlightKindSchema = z.enum([
  /** 3 kills dans la manche. */
  'triple_kill',
  /** 4 kills dans la manche. */
  'quad_kill',
  /** 5 kills dans la manche. */
  'ace',
  /** Dernier en vie face à 2+ adversaires, manche remportée. */
  'clutch',
  /** Désamorçage alors que le tueur était seul en vie. */
  'ninja_defuse',
  /** Désamorçage bouclé à moins d'une seconde de l'explosion. */
  'last_second_defuse',
  /** Kill au couteau. */
  'knife_kill',
  /** Kill au Zeus. */
  'zeus_kill',
  /** Manche remportée en infériorité numérique de 2 joueurs ou plus. */
  'comeback_round',
  /** Nouveau record établi. */
  'record_broken'
])
export type HighlightKind = z.infer<typeof highlightKindSchema>

/** Poids éditorial, pour arbitrer quand deux temps forts tombent ensemble. */
export const HIGHLIGHT_WEIGHT: Record<HighlightKind, number> = {
  ace: 100,
  clutch: 90,
  ninja_defuse: 85,
  quad_kill: 70,
  last_second_defuse: 65,
  knife_kill: 60,
  zeus_kill: 58,
  comeback_round: 50,
  triple_kill: 40,
  record_broken: 30
}

/** Libellé affiché sur la plaque de replay. */
export const HIGHLIGHT_LABEL: Record<HighlightKind, string> = {
  ace: 'ACE',
  clutch: 'CLUTCH',
  ninja_defuse: 'NINJA DEFUSE',
  quad_kill: 'QUAD KILL',
  last_second_defuse: 'DEFUSE À LA SECONDE',
  knife_kill: 'KILL AU COUTEAU',
  zeus_kill: 'KILL AU ZEUS',
  comeback_round: 'REMONTADA',
  triple_kill: 'TRIPLE KILL',
  record_broken: 'RECORD BATTU'
}

export const clipStatusSchema = z.enum([
  /** Capture demandée, fichier pas encore écrit par OBS. */
  'requested',
  /** Fichier brut disponible, découpe/transcodage en cours. */
  'processing',
  /** Clip jouable localement. */
  'ready',
  /** Clip téléversé vers le serveur. */
  'uploaded',
  /** Capture impossible (pas d'OBS, buffer désactivé, disque plein). */
  'failed',
  /** Aucune capture demandée pour ce temps fort. */
  'skipped'
])
export type ClipStatus = z.infer<typeof clipStatusSchema>

export const clipSourceSchema = z.enum(['obs', 'internal'])
export type ClipSource = z.infer<typeof clipSourceSchema>

export const clipSchema = z.object({
  status: clipStatusSchema,
  source: clipSourceSchema.nullable(),
  /** Chemin sur la machine du streamer, jouable par l'overlay en local. */
  localPath: z.string().nullable(),
  /** URL servie par le client local à l'overlay. */
  localUrl: z.string().nullable(),
  /** URL distante après téléversement, pour l'admin et les rediffusions. */
  remoteUrl: z.string().nullable(),
  durationMs: z.number().int().nullable(),
  width: z.number().int().nullable(),
  height: z.number().int().nullable(),
  sizeBytes: z.number().int().nullable(),
  error: z.string().nullable()
})
export type Clip = z.infer<typeof clipSchema>

export const highlightSchema = z.object({
  id: idSchema,
  kind: highlightKindSchema,
  /** Session de diffusion d'origine, pour regrouper dans l'admin. */
  sessionId: idSchema,
  matchId: idSchema.nullable(),

  steamId: steamId64Schema,
  playerName: z.string(),
  playerAvatarUrl: z.string().nullable(),
  teamId: idSchema.nullable(),
  teamName: z.string().nullable(),
  side: sideSchema,
  slot: slotSchema,

  mapName: z.string(),
  round: z.number().int(),
  /** Score au moment du temps fort, orienté gauche/droite. */
  scoreAt: z.object({ left: z.number().int(), right: z.number().int() }),

  /** Nombre de kills concernés (3 à 5 pour les multikills, sinon 1). */
  killCount: z.number().int().min(0),
  /** Adversaires restants au début d'un clutch. */
  clutchAgainst: z.number().int().nullable(),
  victims: z.array(z.object({ steamId: z.string(), name: z.string() })),
  weapons: z.array(z.string()),
  headshots: z.number().int().default(0),

  occurredAt: isoDateSchema,
  clip: clipSchema
})
export type Highlight = z.infer<typeof highlightSchema>

/** Ce que le client envoie au serveur ; le serveur attribue l'id. */
export const createHighlightSchema = highlightSchema.omit({ id: true })
export type CreateHighlight = z.infer<typeof createHighlightSchema>

/**
 * Ordre de capture envoyé au sous-système de replay.
 *
 * `preRollMs` et `postRollMs` encadrent l'instant détecté : un ace se joue sur
 * plusieurs secondes et le compteur ne bascule qu'au dernier kill, donc il faut
 * remonter loin en arrière pour attraper le début de l'action.
 */
export const captureRequestSchema = z.object({
  highlightId: idSchema,
  kind: highlightKindSchema,
  preRollMs: z.number().int().min(1000).max(60_000),
  postRollMs: z.number().int().min(0).max(15_000)
})
export type CaptureRequest = z.infer<typeof captureRequestSchema>

/** Fenêtre de capture par défaut selon le type de temps fort. */
export const CAPTURE_WINDOW: Record<HighlightKind, { preRollMs: number; postRollMs: number }> = {
  ace: { preRollMs: 26_000, postRollMs: 2500 },
  clutch: { preRollMs: 30_000, postRollMs: 3000 },
  quad_kill: { preRollMs: 20_000, postRollMs: 2500 },
  triple_kill: { preRollMs: 14_000, postRollMs: 2000 },
  ninja_defuse: { preRollMs: 16_000, postRollMs: 3000 },
  last_second_defuse: { preRollMs: 12_000, postRollMs: 3000 },
  knife_kill: { preRollMs: 8000, postRollMs: 2000 },
  zeus_kill: { preRollMs: 8000, postRollMs: 2000 },
  comeback_round: { preRollMs: 30_000, postRollMs: 3000 },
  record_broken: { preRollMs: 12_000, postRollMs: 2500 }
}
