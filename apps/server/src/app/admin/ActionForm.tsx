'use client'

import { useActionState, type ReactNode } from 'react'
import { useFormStatus } from 'react-dom'
import { IDLE, type ActionState } from './action-state'

/**
 * Formulaire piloté par une action serveur.
 *
 * Mutualisé parce que toutes les fiches de l'admin ont le même besoin : rendre
 * l'action, afficher son retour, désactiver l'envoi pendant qu'elle tourne. Le
 * message vient de l'action elle-même plutôt que d'un état local — c'est le
 * serveur qui sait si le slug était déjà pris, pas le navigateur.
 */

export function ActionForm({
  action,
  submitLabel,
  children,
  className = 'stack'
}: {
  action: (state: ActionState, form: FormData) => Promise<ActionState>
  submitLabel: string
  children: ReactNode
  className?: string
}) {
  const [state, formAction] = useActionState(action, IDLE)

  return (
    <form action={formAction} className={className}>
      {children}

      {state.message && (
        <p className={`notice ${state.ok ? 'ok' : 'error'}`}>{state.message}</p>
      )}

      {state.secret && (
        <div className="stack">
          <p className="notice warn">
            Copiez cette clé maintenant : seule son empreinte est conservée, elle ne sera plus
            jamais affichée.
          </p>
          <code className="secret">{state.secret}</code>
        </div>
      )}

      <Submit label={submitLabel} />
    </form>
  )
}

function Submit({ label }: { label: string }) {
  // `useFormStatus` n'existe que dans un descendant du `<form>` : appelé dans
  // le composant qui rend le formulaire, il renverrait toujours « au repos ».
  const { pending } = useFormStatus()
  return (
    <button type="submit" className="primary action-submit" disabled={pending}>
      {pending ? 'Enregistrement…' : label}
    </button>
  )
}
