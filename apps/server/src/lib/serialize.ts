import type { GameRecord, Highlight, Player, Session, Team } from '@citronhud/contracts'
import type {
  HighlightRow,
  PlayerRow,
  RecordRow,
  SessionRow,
  TeamRow
} from '../db/schema'

/**
 * Conversion base → API.
 *
 * Un seul endroit pour ces passages : les colonnes PostgreSQL rendent des
 * `Date` et des `jsonb` non typés, alors que les contrats attendent des chaînes
 * ISO et des formes précises. Éparpiller la conversion dans chaque route
 * garantit qu'une d'entre elles finira par renvoyer un objet `Date` brut, que
 * `JSON.stringify` sérialise différemment selon le fuseau du serveur.
 */

const iso = (value: Date) => value.toISOString()
const isoOrNull = (value: Date | null) => (value === null ? null : value.toISOString())

export function toApiTeam(row: TeamRow): Team {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    shortName: row.shortName,
    country: row.country,
    logoUrl: row.logoUrl,
    color: row.color,
    createdBy: row.createdBy,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt)
  }
}

export function toApiPlayer(row: PlayerRow): Player {
  return {
    id: row.id,
    steamId: row.steamId,
    nickname: row.nickname,
    firstName: row.firstName,
    lastName: row.lastName,
    country: row.country,
    avatarUrl: row.avatarUrl,
    teamId: row.teamId,
    role: row.role as Player['role'],
    isCoach: row.isCoach,
    socials: row.socials as Player['socials'],
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt)
  }
}

export function toApiSession(row: SessionRow, highlightCount = 0): Session {
  return {
    id: row.id,
    clientId: row.clientId,
    clientVersion: row.clientVersion,
    label: row.label,
    startedAt: iso(row.startedAt),
    endedAt: isoOrNull(row.endedAt),
    highlightCount
  }
}

export function toApiHighlight(row: HighlightRow): Highlight {
  return {
    id: row.id,
    kind: row.kind as Highlight['kind'],
    sessionId: row.sessionId,
    matchId: row.matchId,
    steamId: row.steamId,
    playerName: row.playerName,
    playerAvatarUrl: row.playerAvatarUrl,
    teamId: row.teamId,
    teamName: row.teamName,
    side: row.side as Highlight['side'],
    slot: row.slot as Highlight['slot'],
    mapName: row.mapName,
    round: row.round,
    scoreAt: { left: row.scoreLeft, right: row.scoreRight },
    killCount: row.killCount,
    clutchAgainst: row.clutchAgainst,
    victims: row.victims as Highlight['victims'],
    weapons: row.weapons as string[],
    headshots: row.headshots,
    occurredAt: iso(row.occurredAt),
    clip: row.clip as Highlight['clip']
  }
}

export function toApiRecord(row: RecordRow): GameRecord {
  return {
    id: row.id,
    scope: row.scope as GameRecord['scope'],
    metric: row.metric as GameRecord['metric'],
    steamId: row.steamId,
    playerName: row.playerName,
    playerAvatarUrl: row.playerAvatarUrl,
    teamId: row.teamId,
    teamName: row.teamName,
    value: row.value,
    mapName: row.mapName,
    matchId: row.matchId,
    sessionId: row.sessionId,
    achievedAt: iso(row.achievedAt),
    previousValue: row.previousValue
  }
}
