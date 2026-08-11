import { desc } from 'drizzle-orm'
import { getDb } from '../../../db'
import { overlayReleases } from '../../../db/schema'
import { storageAvailable } from '../../../lib/s3'
import { ActionForm } from '../ActionForm'
import { publishOverlayRelease, setCurrentOverlayRelease } from '../actions'

export const dynamic = 'force-dynamic'

const dateFormat = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium', timeStyle: 'short' })

function weight(bytes: number): string {
  return bytes < 1024 * 1024
    ? `${Math.round(bytes / 1024)} Ko`
    : `${(bytes / (1024 * 1024)).toFixed(1)} Mo`
}

/**
 * Versions de l'overlay.
 *
 * L'apparence du HUD change beaucoup plus souvent que le moteur du client :
 * corriger un décalage ou une couleur ne doit pas obliger une orga à
 * réinstaller un `.exe` la veille d'un tournoi. Les clients sondent cette
 * version courante et se mettent à jour seuls.
 *
 * L'automatisme se paie : un mauvais bundle se propage tout aussi seul. D'où
 * l'historique conservé et le bouton de retour arrière, qui rétablit une
 * version connue sans reconstruire ni redéployer.
 */
export default async function OverlayPage() {
  const rows = await getDb().select().from(overlayReleases).orderBy(desc(overlayReleases.releasedAt))
  const storage = storageAvailable()

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <h1>Versions de l’overlay</h1>
          <p className="subtitle">
            Le bundle du HUD, mis à jour indépendamment du client. Les régies récupèrent la version
            courante à leur prochaine synchronisation, sans réinstallation.
          </p>
        </div>
      </div>

      {!storage && (
        <p className="notice error">
          Aucun stockage objet n’est configuré : la publication est impossible tant que
          <code> S3_ENDPOINT</code> n’est pas renseigné.
        </p>
      )}

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Version</th>
              <th>Publiée</th>
              <th>Taille</th>
              <th>Client minimum</th>
              <th>Notes</th>
              <th>État</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td style={{ fontFamily: 'var(--font-mono)' }}>{row.version}</td>
                <td className="muted">{dateFormat.format(row.releasedAt)}</td>
                <td className="muted">{weight(row.sizeBytes)}</td>
                <td className="muted">{row.minClientVersion}</td>
                <td className="muted">{row.notes || '—'}</td>
                <td>
                  {row.isCurrent ? (
                    <span className="tag tag-leaf">servie</span>
                  ) : (
                    <span className="tag">archivée</span>
                  )}
                </td>
                <td>
                  {!row.isCurrent && (
                    <form action={setCurrentOverlayRelease}>
                      <input type="hidden" name="id" value={row.id} />
                      <button type="submit" className="link">
                        Rétablir
                      </button>
                    </form>
                  )}
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={7} className="empty">
                  Aucune version publiée. Les clients servent le bundle livré avec leur
                  installation.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <section className="card stack">
        <h2>Publier une version</h2>
        <p className="muted">
          L’archive est celle produite par <code>pnpm --filter @citronhud/overlay build</code>,
          zippée depuis l’intérieur de <code>dist/</code> — <code>index.html</code> doit se trouver
          à la racine du zip, pas dans un sous-dossier.
        </p>
        <ActionForm action={publishOverlayRelease} submitLabel="Publier">
          <div className="field">
            <label htmlFor="version">Version</label>
            <input id="version" name="version" type="text" placeholder="1.2.0" required />
            <span className="hint">
              Comparée telle quelle par le client : une version identique à la sienne n’enclenche
              aucun téléchargement.
            </span>
          </div>

          <div className="field">
            <label htmlFor="bundle">Archive</label>
            <input id="bundle" name="bundle" type="file" accept=".zip,application/zip" required />
          </div>

          <div className="field">
            <label htmlFor="minClientVersion">Version minimale du client</label>
            <input
              id="minClientVersion"
              name="minClientVersion"
              type="text"
              placeholder="0.0.0"
              defaultValue="0.0.0"
            />
            <span className="hint">
              À relever seulement si le bundle a besoin d’une nouveauté du client — sinon les
              anciennes régies se verrouillent sans raison.
            </span>
          </div>

          <div className="field">
            <label htmlFor="notes">Notes</label>
            <input id="notes" name="notes" type="text" placeholder="Killfeed resserré" />
          </div>
        </ActionForm>
      </section>
    </div>
  )
}
