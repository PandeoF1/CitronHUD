import { redirect } from 'next/navigation'
import { currentUser } from '../../lib/auth'
import { LoginForm } from './LoginForm'

/*
 * Jamais pré-rendue : la page décide quoi afficher d'après la session en cours,
 * et la pré-générer au build ferait interroger la base sur une machine de CI
 * qui n'en a pas.
 */
export const dynamic = 'force-dynamic'

export default async function LoginPage() {
  if (await currentUser()) redirect('/admin')

  return (
    <main className="login">
      <div className="login-card">
        <div className="brand">
          <span className="brand-pip" aria-hidden />
          CitronHUD
        </div>
        <p className="subtitle" style={{ margin: 0 }}>
          Administration du roster, des temps forts et des records.
        </p>
        <LoginForm />
      </div>
    </main>
  )
}
