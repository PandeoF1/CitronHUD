import { count, desc, eq, isNull } from 'drizzle-orm'
import Link from 'next/link'
import { HIGHLIGHT_LABEL, RECORD_LABEL, formatRecordValue } from '@citronhud/contracts'
import { getDb } from '../../db'
import { apiKeys, broadcastSessions, highlights, players, records, teams } from '../../db/schema'
import { storageAvailable } from '../../lib/s3'
import { ClipTag } from './ClipTag'

export const dynamic = 'force-dynamic'

const dateFormat = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium', timeStyle: 'short' })

/**
 * Vue d'ensemble.
 *
 * Trois questions, dans cet ordre : le roster est-il en place, que s'est-il
 * passé récemment, et le serveur est-il correctement branché. C'est la séquence
 * réelle du travail d'une orga — d'abord préparer, puis regarder, puis
 * diagnostiquer.
 */
export default async function AdminHome() {
  const db = getDb()

  const [teamTotal, playerTotal, coachTotal, highlightTotal, recordTotal, sessionTotal, keyTotal] =
    await Promise.all([
      db.select({ total: count() }).from(teams),
      db.select({ total: count() }).from(players),
      db.select({ total: count() }).from(players).where(eq(players.isCoach, true)),
      db.select({ total: count() }).from(highlights),
      db.select({ total: count() }).from(records),
      db.select({ total: count() }).from(broadcastSessions),
      db.select({ total: count() }).from(apiKeys).where(isNull(apiKeys.revokedAt))
    ])

  const [recentHighlights, recentRecords, recentSessions] = await Promise.all([
    db.select().from(highlights).orderBy(desc(highlights.occurredAt)).limit(8),
    db.select().from(records).orderBy(desc(records.achievedAt)).limit(6),
    db.select().from(broadcastSessions).orderBy(desc(broadcastSessions.startedAt)).limit(4)
  ])

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <h1>Vue d’ensemble</h1>
          <p className="subtitle">
            Le roster alimente les clients ; les temps forts et les records en reviennent.
          </p>
        </div>
      </div>

      <section className="grid">
        <Stat value={teamTotal[0]?.total ?? 0} label="Équipes" href="/admin/teams" />
        <Stat
          value={playerTotal[0]?.total ?? 0}
          label={`Joueurs · dont ${coachTotal[0]?.total ?? 0} coach(s)`}
          href="/admin/players"
        />
        <Stat
          value={highlightTotal[0]?.total ?? 0}
          label="Temps forts"
          href="/admin/highlights"
        />
        <Stat value={recordTotal[0]?.total ?? 0} label="Records" href="/admin/records" />
        <Stat value={sessionTotal[0]?.total ?? 0} label="Sessions" href="/admin/sessions" />
        <Stat value={keyTotal[0]?.total ?? 0} label="Clés actives" href="/admin/keys" />
      </section>

      {!storageAvailable() && (
        <p className="notice warn">
          Aucun stockage objet configuré : les téléversements d’avatars, de logos et de clips
          répondent 503. Le reste du serveur fonctionne normalement.
        </p>
      )}

      <section className="stack">
        <h2>Derniers temps forts</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Type</th>
                <th>Joueur</th>
                <th>Carte</th>
                <th className="num">Manche</th>
                <th>Clip</th>
                <th>Quand</th>
              </tr>
            </thead>
            <tbody>
              {recentHighlights.map((row) => (
                <tr key={row.id}>
                  <td>
                    <span className="tag tag-rind">
                      {HIGHLIGHT_LABEL[row.kind as keyof typeof HIGHLIGHT_LABEL] ?? row.kind}
                    </span>
                  </td>
                  <td>{row.playerName}</td>
                  <td className="muted">{row.mapName}</td>
                  <td className="num">{row.round}</td>
                  <td>
                    <ClipTag clip={row.clip} />
                  </td>
                  <td className="muted">{dateFormat.format(row.occurredAt)}</td>
                </tr>
              ))}
              {recentHighlights.length === 0 && (
                <tr>
                  <td colSpan={6} className="empty">
                    Aucun temps fort remonté pour l’instant.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))' }}>
        <div className="card stack">
          <h2>Records récents</h2>
          {recentRecords.length === 0 && <p className="muted">Aucun record enregistré.</p>}
          {recentRecords.map((row) => (
            <div key={row.id} className="row" style={{ justifyContent: 'space-between' }}>
              <span>{RECORD_LABEL[row.metric as keyof typeof RECORD_LABEL] ?? row.metric}</span>
              <span className="row">
                <strong style={{ fontFamily: 'var(--font-mono)' }}>
                  {formatRecordValue(row.metric as keyof typeof RECORD_LABEL, row.value)}
                </strong>
                <span className="muted">{row.playerName ?? row.teamName ?? '—'}</span>
              </span>
            </div>
          ))}
        </div>

        <div className="card stack">
          <h2>Sessions récentes</h2>
          {recentSessions.length === 0 && <p className="muted">Aucune session enregistrée.</p>}
          {recentSessions.map((row) => (
            <div key={row.id} className="row" style={{ justifyContent: 'space-between' }}>
              <span>{row.label ?? row.clientId}</span>
              <span className="muted">{dateFormat.format(row.startedAt)}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}

function Stat({ value, label, href }: { value: number; label: string; href: string }) {
  return (
    <Link href={href} className="card stat">
      <span className="stat-value">{value}</span>
      <span className="stat-label">{label}</span>
    </Link>
  )
}
