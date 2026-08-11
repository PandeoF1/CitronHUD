import { count } from 'drizzle-orm'
import { redirect } from 'next/navigation'
import type { ReactNode } from 'react'
import { getDb } from '../../db'
import { broadcastSessions, highlights, players, records, teams } from '../../db/schema'
import { currentUser } from '../../lib/auth'
import { isUnclaimed } from '../../lib/api-key'
import { Nav } from './Nav'
import { SignOut } from './SignOut'

/**
 * Charpente de l'administration.
 *
 * La garde est ici, mais elle ne suffit pas : chaque action serveur revérifie
 * la session de son côté. Un layout protège l'affichage, pas les points
 * d'entrée que ses pages exposent.
 */
export default async function AdminLayout({ children }: { children: ReactNode }) {
  const user = await currentUser()
  if (!user) redirect('/login')

  const db = getDb()
  const [teamCount, playerCount, highlightCount, recordCount, sessionCount] = await Promise.all([
    db.select({ total: count() }).from(teams),
    db.select({ total: count() }).from(players),
    db.select({ total: count() }).from(highlights),
    db.select({ total: count() }).from(records),
    db.select({ total: count() }).from(broadcastSessions)
  ])

  const unclaimed = await isUnclaimed()

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-pip" aria-hidden />
          CitronHUD
        </div>

        <Nav
          items={[
            { href: '/admin', label: "Vue d'ensemble" },
            { href: '/admin/teams', label: 'Équipes', count: teamCount[0]?.total ?? 0 },
            { href: '/admin/players', label: 'Joueurs', count: playerCount[0]?.total ?? 0 },
            {
              href: '/admin/highlights',
              label: 'Temps forts',
              count: highlightCount[0]?.total ?? 0
            },
            { href: '/admin/records', label: 'Records', count: recordCount[0]?.total ?? 0 },
            { href: '/admin/sessions', label: 'Sessions', count: sessionCount[0]?.total ?? 0 },
            { href: '/admin/overlay', label: 'Overlay' },
            { href: '/admin/keys', label: "Clés d'API" }
          ]}
        />

        <div className="sidebar-foot">
          <span>{user.email}</span>
          <SignOut />
        </div>
      </aside>

      <main className="main">
        {unclaimed && (
          <p className="notice warn" style={{ marginBottom: 'var(--space-5)' }}>
            Aucune clé d’API n’existe encore : le serveur accepte tous les clients sans
            authentification. <a href="/admin/keys">Créez la première clé</a> avant de l’exposer sur
            Internet.
          </p>
        )}
        {children}
      </main>
    </div>
  )
}
