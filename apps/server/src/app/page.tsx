import { redirect } from 'next/navigation'

/** La racine n'a rien à montrer : l'application, c'est l'admin. */
export default function Home() {
  redirect('/admin')
}
