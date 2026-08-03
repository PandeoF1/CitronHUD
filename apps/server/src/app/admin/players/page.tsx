import { asc, eq } from 'drizzle-orm'
import Link from 'next/link'
import { getDb } from '../../../db'
import { players, teams } from '../../../db/schema'
import { ActionForm } from '../ActionForm'
import { createPlayer } from '../actions'
import { PlayerFields } from './PlayerFields'

export const dynamic = 'force-dynamic'

export default async function PlayersPage() {
  const db = getDb()

  const rows = await db
    .select({ player: players, team: teams })
    .from(players)
    .leftJoin(teams, eq(players.teamId, teams.id))
    .orderBy(asc(players.nickname))

  const teamRows = await db.select().from(teams).orderBy(asc(teams.name))

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <h1>Joueurs</h1>
          <p className="subtitle">
            Photos, pseudos et appartenances — la donnée que le streamer n’a pas à saisir.
          </p>
        </div>
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th />
              <th>Pseudo</th>
              <th>Nom</th>
              <th>Équipe</th>
              <th>SteamID</th>
              <th>Rôle</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ player, team }) => (
              <tr key={player.id}>
                <td style={{ width: 52 }}>
                  {player.avatarUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img className="avatar" src={player.avatarUrl} alt="" />
                  ) : (
                    <div className="avatar avatar-fallback">
                      {player.nickname.slice(0, 2).toUpperCase()}
                    </div>
                  )}
                </td>
                <td>
                  <Link href={`/admin/players/${player.id}`}>{player.nickname}</Link>
                  {player.isCoach && (
                    <>
                      {' '}
                      <span className="tag">coach</span>
                    </>
                  )}
                </td>
                <td className="muted">
                  {[player.firstName, player.lastName].filter(Boolean).join(' ') || '—'}
                </td>
                <td>
                  {team ? <Link href={`/admin/teams/${team.id}`}>{team.name}</Link> : <span className="muted">—</span>}
                </td>
                <td className="muted" style={{ fontFamily: 'var(--font-mono)' }}>
                  {player.steamId}
                </td>
                <td className="muted">{player.role ?? '—'}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={6} className="empty">
                  Aucun joueur. Créez-en un ci-dessous.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <section className="card stack">
        <h2>Nouveau joueur</h2>
        <ActionForm action={createPlayer} submitLabel="Créer le joueur">
          <PlayerFields teams={teamRows} />
        </ActionForm>
      </section>
    </div>
  )
}
