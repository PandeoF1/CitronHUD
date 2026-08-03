import { asc, desc, eq } from 'drizzle-orm'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { HIGHLIGHT_LABEL, RECORD_LABEL, formatRecordValue } from '@citronhud/contracts'
import { getDb } from '../../../../db'
import { highlights, players, records, teams } from '../../../../db/schema'
import { ActionForm } from '../../ActionForm'
import { ClipTag } from '../../ClipTag'
import { deletePlayer, updatePlayer } from '../../actions'
import { PlayerFields } from '../PlayerFields'

export const dynamic = 'force-dynamic'

const dateFormat = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium', timeStyle: 'short' })

export default async function PlayerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const db = getDb()

  const [player] = await db.select().from(players).where(eq(players.id, id))
  if (!player) notFound()

  const [teamRows, playerHighlights, playerRecords] = await Promise.all([
    db.select().from(teams).orderBy(asc(teams.name)),
    db
      .select()
      .from(highlights)
      .where(eq(highlights.steamId, player.steamId))
      .orderBy(desc(highlights.occurredAt))
      .limit(20),
    db.select().from(records).where(eq(records.steamId, player.steamId))
  ])

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <p className="eyebrow">
            <Link href="/admin/players">Joueurs</Link>
          </p>
          <h1>{player.nickname}</h1>
        </div>
        <form action={deletePlayer}>
          <input type="hidden" name="id" value={player.id} />
          <button type="submit" className="danger">
            Supprimer
          </button>
        </form>
      </div>

      <section className="card stack">
        <h2>Fiche</h2>
        <ActionForm action={updatePlayer} submitLabel="Enregistrer">
          <input type="hidden" name="id" value={player.id} />
          <PlayerFields player={player} teams={teamRows} />
        </ActionForm>
      </section>

      <section className="stack">
        <h2>Records détenus</h2>
        {playerRecords.length === 0 ? (
          <p className="muted">Aucun record à son nom.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Métrique</th>
                  <th>Portée</th>
                  <th className="num">Valeur</th>
                  <th className="num">Précédent</th>
                  <th>Quand</th>
                </tr>
              </thead>
              <tbody>
                {playerRecords.map((row) => (
                  <tr key={row.id}>
                    <td>{RECORD_LABEL[row.metric as keyof typeof RECORD_LABEL] ?? row.metric}</td>
                    <td className="muted">{row.scope}</td>
                    <td className="num">
                      {formatRecordValue(row.metric as keyof typeof RECORD_LABEL, row.value)}
                    </td>
                    <td className="num muted">
                      {row.previousValue === null
                        ? '—'
                        : formatRecordValue(
                            row.metric as keyof typeof RECORD_LABEL,
                            row.previousValue
                          )}
                    </td>
                    <td className="muted">{dateFormat.format(row.achievedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="stack">
        <h2>Temps forts</h2>
        {playerHighlights.length === 0 ? (
          <p className="muted">Aucun temps fort remonté pour ce joueur.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Type</th>
                  <th>Carte</th>
                  <th className="num">Manche</th>
                  <th className="num">Kills</th>
                  <th>Clip</th>
                  <th>Quand</th>
                </tr>
              </thead>
              <tbody>
                {playerHighlights.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <span className="tag tag-rind">
                        {HIGHLIGHT_LABEL[row.kind as keyof typeof HIGHLIGHT_LABEL] ?? row.kind}
                      </span>
                    </td>
                    <td className="muted">{row.mapName}</td>
                    <td className="num">{row.round}</td>
                    <td className="num">{row.killCount}</td>
                    <td>
                      <ClipTag clip={row.clip} />
                    </td>
                    <td className="muted">{dateFormat.format(row.occurredAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}
