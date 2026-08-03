import { createHash } from 'node:crypto'
import { asc } from 'drizzle-orm'
import type { RosterSnapshot } from '@citronhud/contracts'
import { getDb } from '../db'
import { players, teams } from '../db/schema'
import { toApiPlayer, toApiTeam } from './serialize'

/**
 * Instantané du roster servi aux clients.
 *
 * Le roster entier tient en une réponse — quelques centaines de lignes au plus
 * pour une structure — donc pas de pagination ici : le client veut une vue
 * cohérente, et paginer l'exposerait à un roster à moitié à jour au moment
 * précis où un admin renomme une équipe.
 */

/**
 * Empreinte du contenu.
 *
 * Calculée sur les données servies, et non sur un `max(updated_at)` : une
 * suppression ne fait monter aucun horodatage, et le client garderait alors un
 * joueur effacé jusqu'à la prochaine modification sans rapport.
 */
function fingerprint(snapshot: Pick<RosterSnapshot, 'teams' | 'players'>): string {
  const payload = JSON.stringify({ teams: snapshot.teams, players: snapshot.players })
  return createHash('sha256').update(payload).digest('hex').slice(0, 32)
}

export async function rosterSnapshot(): Promise<RosterSnapshot> {
  const db = getDb()
  /*
   * Trié par identifiant plutôt que par nom : l'empreinte doit dépendre du
   * contenu, pas du collationnement de PostgreSQL. Un tri par nom ferait
   * changer le hash au seul changement de locale de la base.
   */
  const [teamRows, playerRows] = await Promise.all([
    db.select().from(teams).orderBy(asc(teams.id)),
    db.select().from(players).orderBy(asc(players.id))
  ])

  const content = {
    teams: teamRows.map(toApiTeam),
    players: playerRows.map(toApiPlayer)
  }

  return {
    ...content,
    version: fingerprint(content),
    fetchedAt: new Date().toISOString()
  }
}
