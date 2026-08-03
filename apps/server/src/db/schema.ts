import { relations, sql } from 'drizzle-orm'
import {
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex
} from 'drizzle-orm/pg-core'

/**
 * Schéma PostgreSQL.
 *
 * Les noms de colonnes sont dérivés en `snake_case` par la configuration
 * `casing` — voir `db/index.ts` et `drizzle.config.ts`, qui doivent rester
 * d'accord entre eux, sinon les migrations générées ne correspondent plus aux
 * requêtes exécutées.
 *
 * Principe de découpage : les tables du roster sont *éditoriales* (saisies dans
 * l'admin, elles font autorité), celles des sessions, temps forts et records
 * sont *rapportées* (poussées par les clients, jamais éditées à la main). Les
 * secondes n'ont donc pas de contrainte de clé étrangère vers les premières :
 * un temps fort reste consultable même si l'équipe qu'il cite est supprimée du
 * roster six mois plus tard.
 */

const timestamps = {
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp({ withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date())
}

/* ---------------------------------------------------------------------------
 * Authentification — tables attendues par better-auth
 *
 * Leurs noms et colonnes sont imposés par l'adaptateur Drizzle de better-auth :
 * les renommer casse la bibliothèque sans erreur de compilation.
 * ------------------------------------------------------------------------- */

export const user = pgTable('user', {
  id: text().primaryKey(),
  name: text().notNull(),
  email: text().notNull().unique(),
  emailVerified: boolean().notNull().default(false),
  image: text(),
  ...timestamps
})

export const session = pgTable('session', {
  id: text().primaryKey(),
  expiresAt: timestamp({ withTimezone: true }).notNull(),
  token: text().notNull().unique(),
  ipAddress: text(),
  userAgent: text(),
  userId: text()
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  ...timestamps
})

export const account = pgTable('account', {
  id: text().primaryKey(),
  accountId: text().notNull(),
  providerId: text().notNull(),
  userId: text()
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  accessToken: text(),
  refreshToken: text(),
  idToken: text(),
  accessTokenExpiresAt: timestamp({ withTimezone: true }),
  refreshTokenExpiresAt: timestamp({ withTimezone: true }),
  scope: text(),
  password: text(),
  ...timestamps
})

export const verification = pgTable('verification', {
  id: text().primaryKey(),
  identifier: text().notNull(),
  value: text().notNull(),
  expiresAt: timestamp({ withTimezone: true }).notNull(),
  ...timestamps
})

/* ---------------------------------------------------------------------------
 * Clés d'API des clients
 * ------------------------------------------------------------------------- */

/**
 * Une clé par régie.
 *
 * Seul le hachage SHA-256 est stocké : la clé en clair n'est montrée qu'une
 * fois, à la création. Une base volée ne donne alors accès à aucune régie, et
 * révoquer une machine perdue ne demande pas de changer la clé de toutes les
 * autres — ce qui arriverait avec une clé partagée.
 *
 * `prefix` retient les huit premiers caractères pour que l'admin puisse
 * reconnaître une clé dans la liste sans jamais la révéler.
 */
export const apiKeys = pgTable(
  'api_keys',
  {
    id: text().primaryKey(),
    label: text().notNull(),
    hash: text().notNull().unique(),
    prefix: text().notNull(),
    createdBy: text().references(() => user.id, { onDelete: 'set null' }),
    lastUsedAt: timestamp({ withTimezone: true }),
    revokedAt: timestamp({ withTimezone: true }),
    ...timestamps
  },
  (table) => [index('api_keys_hash_idx').on(table.hash)]
)

/* ---------------------------------------------------------------------------
 * Roster
 * ------------------------------------------------------------------------- */

export const teams = pgTable('teams', {
  id: text().primaryKey(),
  slug: text().notNull().unique(),
  name: text().notNull(),
  shortName: text().notNull(),
  country: text(),
  logoUrl: text(),
  color: text(),
  createdBy: text().references(() => user.id, { onDelete: 'set null' }),
  ...timestamps
})

export const players = pgTable(
  'players',
  {
    id: text().primaryKey(),
    /** Clé de rattachement au flux GSI. Unique : un SteamID est une personne. */
    steamId: text().notNull().unique(),
    nickname: text().notNull(),
    firstName: text(),
    lastName: text(),
    country: text(),
    avatarUrl: text(),
    /*
     * `set null` et non `cascade` : dissoudre une équipe ne doit pas effacer ses
     * joueurs. Ils redeviennent simplement sans équipe, ce qui est l'état réel.
     */
    teamId: text().references(() => teams.id, { onDelete: 'set null' }),
    role: text(),
    isCoach: boolean().notNull().default(false),
    socials: jsonb(),
    ...timestamps
  },
  (table) => [index('players_team_idx').on(table.teamId)]
)

export const teamsRelations = relations(teams, ({ many }) => ({
  players: many(players)
}))

export const playersRelations = relations(players, ({ one }) => ({
  team: one(teams, { fields: [players.teamId], references: [teams.id] })
}))

/* ---------------------------------------------------------------------------
 * Sessions de diffusion
 * ------------------------------------------------------------------------- */

export const broadcastSessions = pgTable(
  'broadcast_sessions',
  {
    id: text().primaryKey(),
    clientId: text().notNull(),
    clientVersion: text().notNull(),
    label: text(),
    startedAt: timestamp({ withTimezone: true }).notNull(),
    endedAt: timestamp({ withTimezone: true }),
    ...timestamps
  },
  (table) => [index('sessions_started_idx').on(table.startedAt)]
)

/* ---------------------------------------------------------------------------
 * Temps forts
 * ------------------------------------------------------------------------- */

export const highlights = pgTable(
  'highlights',
  {
    /*
     * L'identifiant vient du client, qui l'a déjà écrit dans sa base locale et
     * diffusé à son overlay. Le réutiliser tel quel rend le renvoi idempotent :
     * une file d'envoi rejouée après une coupure ne crée pas de doublons.
     */
    id: text().primaryKey(),
    sessionId: text().notNull(),
    kind: text().notNull(),
    matchId: text(),

    steamId: text().notNull(),
    playerName: text().notNull(),
    playerAvatarUrl: text(),
    teamId: text(),
    teamName: text(),
    side: text().notNull(),
    slot: text().notNull(),

    mapName: text().notNull(),
    round: integer().notNull(),
    scoreLeft: integer().notNull(),
    scoreRight: integer().notNull(),

    killCount: integer().notNull().default(0),
    clutchAgainst: integer(),
    victims: jsonb().notNull().default(sql`'[]'::jsonb`),
    weapons: jsonb().notNull().default(sql`'[]'::jsonb`),
    headshots: integer().notNull().default(0),

    occurredAt: timestamp({ withTimezone: true }).notNull(),
    clip: jsonb().notNull(),
    ...timestamps
  },
  (table) => [
    index('highlights_session_idx').on(table.sessionId),
    index('highlights_steam_idx').on(table.steamId),
    index('highlights_occurred_idx').on(table.occurredAt)
  ]
)

/* ---------------------------------------------------------------------------
 * Records
 * ------------------------------------------------------------------------- */

/**
 * Le record *en vigueur* pour chaque combinaison portée / métrique / sujet.
 *
 * Une seule ligne par record, mise à jour quand il tombe — et non un historique
 * dont il faudrait extraire le maximum à chaque lecture. L'arbitrage se fait à
 * l'écriture, côté serveur : c'est ce qui empêche un client à l'heure fausse ou
 * modifié d'inscrire n'importe quelle valeur.
 *
 * `subjectKey` normalise le sujet (SteamID, identifiant d'équipe, ou chaîne
 * vide pour la portée globale) parce qu'un index unique PostgreSQL considère
 * deux `NULL` comme distincts : sans lui, la même performance mondiale pourrait
 * être insérée deux fois.
 */
export const records = pgTable(
  'records',
  {
    id: text().primaryKey(),
    scope: text().notNull(),
    metric: text().notNull(),
    subjectKey: text().notNull(),

    steamId: text(),
    playerName: text(),
    playerAvatarUrl: text(),
    teamId: text(),
    teamName: text(),

    value: doublePrecision().notNull(),
    previousValue: doublePrecision(),
    mapName: text(),
    matchId: text(),
    sessionId: text(),
    achievedAt: timestamp({ withTimezone: true }).notNull(),
    ...timestamps
  },
  (table) => [
    uniqueIndex('records_unique_idx').on(table.scope, table.metric, table.subjectKey),
    index('records_metric_idx').on(table.metric)
  ]
)

/* ---------------------------------------------------------------------------
 * Diffusion de l'overlay
 * ------------------------------------------------------------------------- */

/**
 * Versions publiées du bundle overlay.
 *
 * L'overlay se met à jour séparément du binaire du client : corriger une
 * couleur ne doit pas obliger une orga à réinstaller un `.exe` la veille d'un
 * tournoi. `isCurrent` désigne la version servie ; on garde les précédentes
 * pour pouvoir revenir en arrière sans reconstruire quoi que ce soit.
 */
export const overlayReleases = pgTable('overlay_releases', {
  id: text().primaryKey(),
  version: text().notNull().unique(),
  url: text().notNull(),
  sha256: text().notNull(),
  sizeBytes: integer().notNull(),
  minClientVersion: text().notNull(),
  notes: text().notNull().default(''),
  isCurrent: boolean().notNull().default(false),
  releasedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  ...timestamps
})

export type TeamRow = typeof teams.$inferSelect
export type PlayerRow = typeof players.$inferSelect
export type SessionRow = typeof broadcastSessions.$inferSelect
export type HighlightRow = typeof highlights.$inferSelect
export type RecordRow = typeof records.$inferSelect
export type ApiKeyRow = typeof apiKeys.$inferSelect
export type OverlayReleaseRow = typeof overlayReleases.$inferSelect
