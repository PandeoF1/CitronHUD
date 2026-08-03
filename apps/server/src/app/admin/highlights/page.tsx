import { desc } from 'drizzle-orm'
import { HIGHLIGHT_LABEL, type Clip } from '@citronhud/contracts'
import { getDb } from '../../../db'
import { highlights } from '../../../db/schema'
import { ClipTag } from '../ClipTag'
import { deleteHighlight } from '../actions'

export const dynamic = 'force-dynamic'

const dateFormat = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium', timeStyle: 'short' })

/**
 * Historique des temps forts.
 *
 * Les cent derniers, sans pagination : au-delà, ce n'est plus une revue mais
 * une recherche, et le filtrage par joueur se fait déjà depuis sa fiche.
 */
export default async function HighlightsPage() {
  const rows = await getDb()
    .select()
    .from(highlights)
    .orderBy(desc(highlights.occurredAt))
    .limit(100)

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <h1>Temps forts</h1>
          <p className="subtitle">
            Remontés par les clients. Le clip n’arrive qu’ensuite, quand une capture était possible.
          </p>
        </div>
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Type</th>
              <th>Joueur</th>
              <th>Équipe</th>
              <th>Carte</th>
              <th className="num">Manche</th>
              <th className="num">Score</th>
              <th className="num">Kills</th>
              <th>Clip</th>
              <th>Quand</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const clip = row.clip as Clip
              return (
                <tr key={row.id}>
                  <td>
                    <span className="tag tag-rind">
                      {HIGHLIGHT_LABEL[row.kind as keyof typeof HIGHLIGHT_LABEL] ?? row.kind}
                    </span>
                  </td>
                  <td>{row.playerName}</td>
                  <td className="muted">{row.teamName ?? '—'}</td>
                  <td className="muted">{row.mapName}</td>
                  <td className="num">{row.round}</td>
                  <td className="num">
                    {row.scoreLeft}–{row.scoreRight}
                  </td>
                  <td className="num">{row.killCount}</td>
                  <td>
                    {clip.remoteUrl ? (
                      <a href={clip.remoteUrl} target="_blank" rel="noreferrer">
                        <ClipTag clip={clip} />
                      </a>
                    ) : (
                      <ClipTag clip={clip} />
                    )}
                  </td>
                  <td className="muted">{dateFormat.format(row.occurredAt)}</td>
                  <td>
                    <form action={deleteHighlight}>
                      <input type="hidden" name="id" value={row.id} />
                      <button type="submit" className="link">
                        Supprimer
                      </button>
                    </form>
                  </td>
                </tr>
              )
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={10} className="empty">
                  Aucun temps fort remonté. Ils arrivent dès qu’un client synchronise.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
