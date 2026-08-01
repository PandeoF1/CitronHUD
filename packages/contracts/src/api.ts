import { z } from 'zod'
import { idSchema, isoDateSchema, paginatedSchema } from './common'
import { createPlayerSchema, createTeamSchema, playerSchema, rosterSnapshotSchema, teamSchema } from './roster'
import { createHighlightSchema, highlightSchema } from './highlight'
import { createRecordSchema, recordMetricSchema, recordSchema, recordScopeSchema } from './record'

/**
 * API v1 — contrat entre le client Electron et le serveur.
 *
 * Versionnée dans l'URL parce que les clients se mettent à jour tout seuls mais
 * pas tous en même temps : pendant un tournoi, une v1.2 et une v1.4 tapent le
 * même serveur, et casser le contrat couperait une régie en direct.
 */

export const API_VERSION = 'v1' as const

export const API_ROUTES = {
  health: '/api/v1/health',
  roster: '/api/v1/roster',
  teams: '/api/v1/teams',
  team: (id: string) => `/api/v1/teams/${id}`,
  players: '/api/v1/players',
  player: (id: string) => `/api/v1/players/${id}`,
  sessions: '/api/v1/sessions',
  session: (id: string) => `/api/v1/sessions/${id}`,
  highlights: '/api/v1/highlights',
  highlight: (id: string) => `/api/v1/highlights/${id}`,
  highlightClip: (id: string) => `/api/v1/highlights/${id}/clip`,
  records: '/api/v1/records',
  recordsSync: '/api/v1/records/sync',
  uploads: '/api/v1/uploads',
  overlayManifest: '/api/v1/overlay/manifest'
} as const

/** En-tête portant la clé d'API du client. */
export const API_KEY_HEADER = 'x-citron-key'
/** En-tête portant la version du client, pour les diagnostics serveur. */
export const CLIENT_VERSION_HEADER = 'x-citron-client'

export const healthResponseSchema = z.object({
  ok: z.literal(true),
  version: z.string(),
  time: isoDateSchema
})

/* ---------------------------------------------------------------------------
 * Roster
 * ------------------------------------------------------------------------- */

export const rosterQuerySchema = z.object({
  /** Hash connu du client ; le serveur répond 304 s'il correspond. */
  version: z.string().optional()
})

export const rosterResponseSchema = rosterSnapshotSchema

export const teamListResponseSchema = paginatedSchema(teamSchema)
export const playerListResponseSchema = paginatedSchema(playerSchema)

export const createTeamRequestSchema = createTeamSchema
export const createPlayerRequestSchema = createPlayerSchema

/* ---------------------------------------------------------------------------
 * Sessions de diffusion
 *
 * Une session regroupe tout ce qui s'est passé pendant un live : temps forts,
 * records, matchs joués. Elle sert de clé de regroupement dans l'admin.
 * ------------------------------------------------------------------------- */

export const createSessionSchema = z.object({
  /** Identifiant stable de la machine du streamer. */
  clientId: z.string().min(1).max(128),
  clientVersion: z.string(),
  label: z.string().max(120).optional(),
  startedAt: isoDateSchema
})
export type CreateSession = z.infer<typeof createSessionSchema>

export const sessionSchema = z.object({
  id: idSchema,
  clientId: z.string(),
  clientVersion: z.string(),
  label: z.string().nullable(),
  startedAt: isoDateSchema,
  endedAt: isoDateSchema.nullable(),
  highlightCount: z.number().int().default(0)
})
export type Session = z.infer<typeof sessionSchema>

/* ---------------------------------------------------------------------------
 * Temps forts
 * ------------------------------------------------------------------------- */

export const createHighlightRequestSchema = createHighlightSchema
export const highlightListQuerySchema = z.object({
  sessionId: idSchema.optional(),
  steamId: z.string().optional(),
  kind: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
  cursor: z.string().optional()
})
export const highlightListResponseSchema = paginatedSchema(highlightSchema)

/**
 * Réponse à une demande de téléversement de clip.
 *
 * Le serveur renvoie une URL présignée : la vidéo va directement du poste du
 * streamer au stockage objet, sans transiter par le process Next.js. Un clip de
 * 40 Mo qui traverse le serveur applicatif bloque un worker pendant toute la
 * montée, ce qui est intenable quand plusieurs régies téléversent ensemble.
 */
export const clipUploadTicketSchema = z.object({
  uploadUrl: z.url(),
  /** En-têtes à rejouer tels quels sur le PUT. */
  headers: z.record(z.string(), z.string()),
  /** URL publique du clip une fois le téléversement terminé. */
  publicUrl: z.url(),
  expiresAt: isoDateSchema
})
export type ClipUploadTicket = z.infer<typeof clipUploadTicketSchema>

export const clipUploadRequestSchema = z.object({
  contentType: z.string().default('video/mp4'),
  sizeBytes: z.number().int().min(1),
  durationMs: z.number().int().min(1)
})

/* ---------------------------------------------------------------------------
 * Records
 * ------------------------------------------------------------------------- */

export const recordQuerySchema = z.object({
  scope: recordScopeSchema.optional(),
  metric: recordMetricSchema.optional(),
  steamId: z.string().optional(),
  teamId: idSchema.optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50)
})

export const recordListResponseSchema = z.object({
  items: z.array(recordSchema)
})

/**
 * Synchronisation des records.
 *
 * Le client envoie ses candidats accumulés hors ligne ; le serveur arbitre et
 * renvoie l'état retenu. L'arbitrage est côté serveur pour qu'une machine à
 * l'heure fausse ou un client trafiqué ne puisse pas écraser un vrai record.
 */
export const recordSyncRequestSchema = z.object({
  sessionId: idSchema,
  candidates: z.array(createRecordSchema)
})
export const recordSyncResponseSchema = z.object({
  accepted: z.array(recordSchema),
  rejected: z.array(
    z.object({
      metric: recordMetricSchema,
      steamId: z.string().nullable(),
      reason: z.string()
    })
  )
})

/* ---------------------------------------------------------------------------
 * Mise à jour de l'overlay
 *
 * L'overlay se met à jour indépendamment du binaire du client : corriger une
 * couleur ou un décalage ne doit pas obliger toute une orga à réinstaller un
 * .exe la veille d'un tournoi.
 * ------------------------------------------------------------------------- */

export const overlayManifestSchema = z.object({
  version: z.string(),
  /** Archive zip du bundle overlay. */
  url: z.url(),
  /** Somme SHA-256 en hexadécimal, vérifiée avant extraction. */
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  sizeBytes: z.number().int(),
  /** Version minimale du client capable de lire ce bundle. */
  minClientVersion: z.string(),
  releasedAt: isoDateSchema,
  notes: z.string().default('')
})
export type OverlayManifest = z.infer<typeof overlayManifestSchema>
