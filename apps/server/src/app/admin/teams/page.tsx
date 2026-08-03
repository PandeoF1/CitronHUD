import { asc, count, eq } from 'drizzle-orm'
import Link from 'next/link'
import { getDb } from '../../../db'
import { players, teams } from '../../../db/schema'
import { ActionForm } from '../ActionForm'
import { createTeam } from '../actions'
import { TeamFields } from './TeamFields'

export const dynamic = 'force-dynamic'

export default async function TeamsPage() {
  const db = getDb()
  const rows = await db.select().from(teams).orderBy(asc(teams.name))

  const sizes = await Promise.all(
    rows.map(async (row) => {
      const [result] = await db
        .select({ total: count() })
        .from(players)
        .where(eq(players.teamId, row.id))
      return result?.total ?? 0
    })
  )

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <h1>Équipes</h1>
          <p className="subtitle">
            Ce que le streamer choisit avant un match. Le nom court est celui qui passe à l’antenne.
          </p>
        </div>
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th />
              <th>Nom</th>
              <th>Court</th>
              <th>Slug</th>
              <th>Pays</th>
              <th className="num">Joueurs</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={row.id}>
                <td style={{ width: 52 }}>
                  {row.logoUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img className="logo" src={row.logoUrl} alt="" />
                  ) : (
                    <div className="logo avatar-fallback">{row.shortName.slice(0, 2)}</div>
                  )}
                </td>
                <td>
                  <Link href={`/admin/teams/${row.id}`}>{row.name}</Link>
                </td>
                <td>
                  <span className="tag" style={row.color ? { color: row.color } : undefined}>
                    {row.shortName}
                  </span>
                </td>
                <td className="muted">{row.slug}</td>
                <td className="muted">{row.country ?? '—'}</td>
                <td className="num">{sizes[index] ?? 0}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={6} className="empty">
                  Aucune équipe. Créez-en une ci-dessous.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <section className="card stack">
        <h2>Nouvelle équipe</h2>
        <ActionForm action={createTeam} submitLabel="Créer l’équipe">
          <TeamFields />
        </ActionForm>
      </section>
    </div>
  )
}
