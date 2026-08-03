'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

/**
 * Navigation latérale.
 *
 * Client uniquement pour `usePathname` : marquer la page courante côté serveur
 * demanderait de passer le chemin en prop à chaque rendu, ce qui reviendrait au
 * même en plus fragile.
 */

export interface NavItem {
  href: string
  label: string
  count?: number
}

export function Nav({ items }: { items: NavItem[] }) {
  const pathname = usePathname()

  return (
    <nav className="nav">
      {items.map((item) => {
        // `/admin` ne doit pas rester actif sur `/admin/teams` : c'est le seul
        // préfixe de tous les autres, donc le seul à comparer strictement.
        const active =
          item.href === '/admin' ? pathname === '/admin' : pathname.startsWith(item.href)

        return (
          <Link key={item.href} href={item.href} aria-current={active ? 'page' : undefined}>
            <span>{item.label}</span>
            {item.count !== undefined && <span className="nav-count">{item.count}</span>}
          </Link>
        )
      })}
    </nav>
  )
}
