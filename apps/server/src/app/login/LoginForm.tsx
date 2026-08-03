'use client'

import { useRouter } from 'next/navigation'
import { useState, type FormEvent } from 'react'
import { authClient } from '../../lib/auth-client'

/**
 * Connexion.
 *
 * Le message d'erreur reste volontairement identique quel que soit le motif —
 * adresse inconnue ou mot de passe faux. Les distinguer révélerait quelles
 * adresses ont un compte sur ce serveur, ce qui est exactement l'information
 * que cherche quelqu'un qui essaie d'y entrer.
 */
export function LoginForm() {
  const router = useRouter()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    setPending(true)
    setError(null)

    const result = await authClient.signIn.email({
      email: String(form.get('email') ?? ''),
      password: String(form.get('password') ?? '')
    })

    if (result.error) {
      setError('Adresse ou mot de passe incorrect.')
      setPending(false)
      return
    }

    router.push('/admin')
    router.refresh()
  }

  return (
    <form onSubmit={onSubmit} className="stack">
      <div className="field">
        <label htmlFor="email">Adresse</label>
        <input id="email" name="email" type="email" autoComplete="username" required />
      </div>
      <div className="field">
        <label htmlFor="password">Mot de passe</label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
        />
      </div>

      {error && <p className="notice error">{error}</p>}

      <button type="submit" className="primary" disabled={pending}>
        {pending ? 'Connexion…' : 'Se connecter'}
      </button>
    </form>
  )
}
