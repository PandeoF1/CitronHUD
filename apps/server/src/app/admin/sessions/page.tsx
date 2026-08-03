import { count, desc, eq } from 'drizzle-orm'
import { getDb } from '../../../db'
import { broadcastSessions, highlights } from '../../../db/schema'

export const dynamic = 'force-dynamic'

const dateFormat = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium', timeStyle: 'short' })

/**
 * Sessions de diffusion.
 *
 * Une session par live. Certaines n'ont jamais été déclarées explicitement : le
 * client commence à diffuser sans attendre le réseau, et le serveur crée alors
 * la session au premier temps fort reçu. Elles apparaissent comme « client
 * inconnu », ce qui est l'information exacte dont on dispose.
 */
export default async function SessionsPage() {
  const db = getDb()
  const rows = await db
    .select()
    .from(broadcastSessions)
    .orderBy(desc(broadcastSessions.startedAt))
    .limit(100)

  const counts = await Promise.all(
    rows.map(async (row) => {
      const [result] = await db
        .select({ total: count() })
        .from(highlights)
        .where(eq(highlights.sessionId, row.id))
      return result?.total ?? 0
    })
  )

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <h1>Sessions</h1>
          <p className="subtitle">Chaque live et ce qu’il a produit.</p>
        </div>
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Session</th>
              <th>Client</th>
              <th>Version</th>
              <th>Début</th>
              <th>Fin</th>
              <th className="num">Temps forts</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={row.id}>
                <td>{row.label ?? <span className="muted">sans nom</span>}</td>
                <td className="muted" style={{ fontFamily: 'var(--font-mono)' }}>
                  {row.clientId}
                </td>
                <td className="muted">{row.clientVersion}</td>
                <td className="muted">{dateFormat.format(row.startedAt)}</td>
                <td className="muted">
                  {row.endedAt ? (
                    dateFormat.format(row.endedAt)
                  ) : (
                    <span className="tag tag-leaf">en cours</span>
                  )}
                </td>
                <td className="num">{counts[index] ?? 0}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={6} className="empty">
                  Aucune session enregistrée.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
