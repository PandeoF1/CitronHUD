import { asc, eq } from 'drizzle-orm'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getDb } from '../../../../db'
import { players, teams } from '../../../../db/schema'
import { ActionForm } from '../../ActionForm'
import { deleteTeam, updateTeam } from '../../actions'
import { TeamFields } from '../TeamFields'

export const dynamic = 'force-dynamic'

export default async function TeamPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const db = getDb()

  const [team] = await db.select().from(teams).where(eq(teams.id, id))
  if (!team) notFound()

  const roster = await db
    .select()
    .from(players)
    .where(eq(players.teamId, id))
    .orderBy(asc(players.nickname))

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <p className="eyebrow">
            <Link href="/admin/teams">Équipes</Link>
          </p>
          <h1>{team.name}</h1>
        </div>
        <form action={deleteTeam}>
          <input type="hidden" name="id" value={team.id} />
          <button type="submit" className="danger">
            Supprimer
          </button>
        </form>
      </div>

      <section className="card stack">
        <h2>Fiche</h2>
        <ActionForm action={updateTeam} submitLabel="Enregistrer">
          <input type="hidden" name="id" value={team.id} />
          <TeamFields team={team} />
        </ActionForm>
      </section>

      <section className="stack">
        <h2>Effectif</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th />
                <th>Pseudo</th>
                <th>SteamID</th>
                <th>Rôle</th>
              </tr>
            </thead>
            <tbody>
              {roster.map((player) => (
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
                  <td className="muted" style={{ fontFamily: 'var(--font-mono)' }}>
                    {player.steamId}
                  </td>
                  <td className="muted">{player.role ?? '—'}</td>
                </tr>
              ))}
              {roster.length === 0 && (
                <tr>
                  <td colSpan={4} className="empty">
                    Aucun joueur rattaché à cette équipe.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}
