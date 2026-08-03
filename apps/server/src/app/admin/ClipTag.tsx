/**
 * Statut du clip attaché à un temps fort.
 *
 * Dans son propre module et non dans une page : Next impose la liste des
 * exports d'un `page.tsx`, et y ajouter un composant fait échouer le build sur
 * une erreur de type qui ne dit pas d'où elle vient.
 */

const LABEL: Record<string, string> = {
  requested: 'demandé',
  processing: 'en cours',
  ready: 'local',
  uploaded: 'téléversé',
  failed: 'échec',
  skipped: 'aucun'
}

export function ClipTag({ clip }: { clip: unknown }) {
  const status = (clip as { status?: string } | null)?.status ?? 'skipped'
  const tone =
    status === 'uploaded' || status === 'ready'
      ? 'tag-leaf'
      : status === 'failed'
        ? 'tag-blood'
        : ''

  return <span className={`tag ${tone}`}>{LABEL[status] ?? status}</span>
}
