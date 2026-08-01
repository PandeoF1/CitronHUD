import Database from 'better-sqlite3'
import type { Player, Team } from '@citronhud/contracts'
import { databasePath } from './paths'

/**
 * Cache local du roster et journal des évènements.
 *
 * Le client est « local d'abord » : il lit TOUJOURS depuis cette base, jamais
 * depuis le réseau au moment de dessiner. Le serveur ne fait qu'alimenter le
 * cache en arrière-plan. Conséquence directe : une coupure réseau en plein
 * match ne change strictement rien à l'antenne.
 *
 * Les temps forts et records produits hors ligne s'empilent dans `outbox` et
 * partent quand le serveur redevient joignable.
 */

let db: Database.Database | null = null

export function getDb(): Database.Database {
  if (db) return db

  db = new Database(databasePath())
  // WAL : la lecture pendant l'écriture ne bloque pas. Le moteur écrit des
  // évènements pendant que le panneau lit le roster, dix fois par seconde.
  db.pragma('journal_mode = WAL')

  db.exec(`
    CREATE TABLE IF NOT EXISTS teams (
      id          TEXT PRIMARY KEY,
      payload     TEXT NOT NULL,
      updated_at  TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS players (
      steam_id    TEXT PRIMARY KEY,
      team_id     TEXT,
      payload     TEXT NOT NULL,
      updated_at  TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS players_team_idx ON players(team_id);

    CREATE TABLE IF NOT EXISTS records (
      metric      TEXT NOT NULL,
      scope       TEXT NOT NULL,
      steam_id    TEXT,
      value       REAL NOT NULL,
      payload     TEXT NOT NULL,
      updated_at  TEXT NOT NULL,
      PRIMARY KEY (metric, scope, steam_id)
    );

    CREATE TABLE IF NOT EXISTS highlights (
      id          TEXT PRIMARY KEY,
      payload     TEXT NOT NULL,
      clip_path   TEXT,
      created_at  TEXT NOT NULL
    );

    -- File d'envoi : ce qui doit remonter au serveur dès qu'il répond.
    CREATE TABLE IF NOT EXISTS outbox (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      kind        TEXT NOT NULL,
      payload     TEXT NOT NULL,
      attempts    INTEGER NOT NULL DEFAULT 0,
      created_at  TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS meta (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `)

  return db
}

const now = (): string => new Date().toISOString()

/** Remplace intégralement le roster local par celui du serveur. */
export function replaceRoster(teams: Team[], players: Player[]): void {
  const database = getDb()
  const timestamp = now()

  const wipeTeams = database.prepare('DELETE FROM teams')
  const wipePlayers = database.prepare('DELETE FROM players')
  const insertTeam = database.prepare(
    'INSERT INTO teams (id, payload, updated_at) VALUES (?, ?, ?)'
  )
  const insertPlayer = database.prepare(
    'INSERT INTO players (steam_id, team_id, payload, updated_at) VALUES (?, ?, ?, ?)'
  )

  /*
   * Transaction unique : un roster à moitié remplacé pendant une trame GSI
   * ferait clignoter les identités des joueurs à l'antenne.
   */
  database.transaction(() => {
    wipeTeams.run()
    wipePlayers.run()
    for (const team of teams) insertTeam.run(team.id, JSON.stringify(team), timestamp)
    for (const player of players) {
      if (!player.steamId) continue
      insertPlayer.run(player.steamId, player.teamId ?? null, JSON.stringify(player), timestamp)
    }
  })()
}

export function loadRoster(): { teams: Map<string, Team>; players: Map<string, Player> } {
  const database = getDb()
  const teams = new Map<string, Team>()
  const players = new Map<string, Player>()

  for (const row of database.prepare('SELECT payload FROM teams').all() as { payload: string }[]) {
    const team = JSON.parse(row.payload) as Team
    teams.set(team.id, team)
  }
  for (const row of database.prepare('SELECT payload FROM players').all() as {
    payload: string
  }[]) {
    const player = JSON.parse(row.payload) as Player
    players.set(player.steamId, player)
  }

  return { teams, players }
}

/** Ajoute une entrée à la file d'envoi. */
export function enqueue(kind: string, payload: unknown): void {
  getDb()
    .prepare('INSERT INTO outbox (kind, payload, created_at) VALUES (?, ?, ?)')
    .run(kind, JSON.stringify(payload), now())
}

export interface OutboxRow {
  id: number
  kind: string
  payload: string
  attempts: number
}

export function peekOutbox(limit = 25): OutboxRow[] {
  return getDb()
    .prepare('SELECT id, kind, payload, attempts FROM outbox ORDER BY id LIMIT ?')
    .all(limit) as OutboxRow[]
}

export function dropOutbox(ids: number[]): void {
  if (ids.length === 0) return
  const placeholders = ids.map(() => '?').join(',')
  getDb()
    .prepare(`DELETE FROM outbox WHERE id IN (${placeholders})`)
    .run(...ids)
}

/**
 * Marque un échec d'envoi.
 *
 * Au-delà de dix tentatives, l'entrée est abandonnée : une charge utile que le
 * serveur refuse systématiquement (schéma obsolète, clip corrompu) bloquerait
 * sinon la file pour toujours.
 */
export function failOutbox(ids: number[]): void {
  if (ids.length === 0) return
  const database = getDb()
  const bump = database.prepare('UPDATE outbox SET attempts = attempts + 1 WHERE id = ?')
  database.transaction(() => {
    for (const id of ids) bump.run(id)
    database.prepare('DELETE FROM outbox WHERE attempts >= 10').run()
  })()
}

export function getMeta(key: string): string | null {
  const row = getDb().prepare('SELECT value FROM meta WHERE key = ?').get(key) as
    { value: string } | undefined
  return row?.value ?? null
}

export function setMeta(key: string, value: string): void {
  getDb()
    .prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = ?')
    .run(key, value, value)
}

export function closeDb(): void {
  db?.close()
  db = null
}
