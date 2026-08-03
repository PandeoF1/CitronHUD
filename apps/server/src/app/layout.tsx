import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import './admin.css'

export const metadata: Metadata = {
  title: 'CitronHUD — Administration',
  description: 'Roster, temps forts et records de Citron Esport.'
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="fr">
      <body>{children}</body>
    </html>
  )
}
