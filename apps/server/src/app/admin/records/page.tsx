import { asc, desc } from 'drizzle-orm'
import { RECORD_LABEL, formatRecordValue, type RecordMetric } from '@citronhud/contracts'
import { getDb } from '../../../db'
import { records } from '../../../db/schema'
import { deleteRecord } from '../actions'

export const dynamic = 'force-dynamic'

const dateFormat = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium' })

const SCOPE_LABEL: Record<string, string> = {
  player: 'Joueur',
  team: 'Équipe',
  global: 'Global'
}

/**
 * Records en vigueur.
 *
 * Une ligne par record, pas un historique : l'arbitrage se fait à l'écriture,
 * donc ce que montre cette page est exactement ce que les clients recevront.
 *
 * La suppression existe pour une raison précise : un record inscrit pendant une
 * partie de test ou par un client d'une version dont le comptage était faux
 * n'est corrigeable que comme ça — la valeur en place ne peut plus être battue
 * si elle est absurde.
 */
export default async function RecordsPage() {
  const rows = await getDb()
    .select()
    .from(records)
    .orderBy(asc(records.metric), desc(records.value))

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <h1>Records</h1>
          <p className="subtitle">
            Arbitrés par le serveur : un client ne peut pas inscrire une valeur qu’il n’a pas
            battue.
          </p>
        </div>
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Métrique</th>
              <th>Portée</th>
              <th>Détenteur</th>
              <th className="num">Valeur</th>
              <th className="num">Précédent</th>
              <th>Carte</th>
              <th>Quand</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const metric = row.metric as RecordMetric
              return (
                <tr key={row.id}>
                  <td>{RECORD_LABEL[metric] ?? row.metric}</td>
                  <td>
                    <span className="tag">{SCOPE_LABEL[row.scope] ?? row.scope}</span>
                  </td>
                  <td>{row.playerName ?? row.teamName ?? <span className="muted">—</span>}</td>
                  <td className="num">
                    <strong>{formatRecordValue(metric, row.value)}</strong>
                  </td>
                  <td className="num muted">
                    {row.previousValue === null
                      ? '—'
                      : formatRecordValue(metric, row.previousValue)}
                  </td>
                  <td className="muted">{row.mapName ?? '—'}</td>
                  <td className="muted">{dateFormat.format(row.achievedAt)}</td>
                  <td>
                    <form action={deleteRecord}>
                      <input type="hidden" name="id" value={row.id} />
                      <button type="submit" className="link">
                        Effacer
                      </button>
                    </form>
                  </td>
                </tr>
              )
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={8} className="empty">
                  Aucun record. Le premier match en établira une série complète.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
