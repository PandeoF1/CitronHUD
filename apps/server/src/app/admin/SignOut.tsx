'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { authClient } from '../../lib/auth-client'

export function SignOut() {
  const router = useRouter()
  const [pending, setPending] = useState(false)

  return (
    <button
      type="button"
      className="link"
      disabled={pending}
      onClick={async () => {
        setPending(true)
        await authClient.signOut()
        router.push('/login')
        router.refresh()
      }}
    >
      Se déconnecter
    </button>
  )
}
