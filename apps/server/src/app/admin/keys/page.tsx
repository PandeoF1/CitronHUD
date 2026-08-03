import { desc } from 'drizzle-orm'
import { API_KEY_HEADER } from '@citronhud/contracts'
import { getDb } from '../../../db'
import { apiKeys } from '../../../db/schema'
import { publicUrl } from '../../../lib/env'
import { ActionForm } from '../ActionForm'
import { createApiKey, revokeApiKey } from '../actions'

export const dynamic = 'force-dynamic'

const dateFormat = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium', timeStyle: 'short' })

/**
 * Clés d'API.
 *
 * Une clé par régie plutôt qu'une clé partagée : révoquer une machine perdue ne
 * doit pas obliger à reconfigurer toutes les autres la veille d'un tournoi. La
 * colonne « dernier usage » sert à ça — elle dit quelles clés sont vivantes et
 * lesquelles peuvent partir sans risque.
 */
export default async function KeysPage() {
  const rows = await getDb().select().from(apiKeys).orderBy(desc(apiKeys.createdAt))

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <h1>Clés d’API</h1>
          <p className="subtitle">
            Une clé lit le roster et rapporte l’activité. Elle ne modifie jamais le roster : cela
            reste réservé à cette interface.
          </p>
        </div>
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Nom</th>
              <th>Empreinte</th>
              <th>Créée</th>
              <th>Dernier usage</th>
              <th>État</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td>{row.label}</td>
                <td className="muted" style={{ fontFamily: 'var(--font-mono)' }}>
                  {row.prefix}…
                </td>
                <td className="muted">{dateFormat.format(row.createdAt)}</td>
                <td className="muted">
                  {row.lastUsedAt ? dateFormat.format(row.lastUsedAt) : 'jamais'}
                </td>
                <td>
                  {row.revokedAt ? (
                    <span className="tag tag-blood">révoquée</span>
                  ) : (
                    <span className="tag tag-leaf">active</span>
                  )}
                </td>
                <td>
                  {!row.revokedAt && (
                    <form action={revokeApiKey}>
                      <input type="hidden" name="id" value={row.id} />
                      <button type="submit" className="link">
                        Révoquer
                      </button>
                    </form>
                  )}
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={6} className="empty">
                  Aucune clé. Tant que cette liste est vide, le serveur accepte tous les clients.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <section className="card stack">
        <h2>Nouvelle clé</h2>
        <ActionForm action={createApiKey} submitLabel="Créer la clé">
          <div className="field">
            <label htmlFor="label">Nom</label>
            <input
              id="label"
              name="label"
              type="text"
              placeholder="Régie principale"
              required
            />
            <span className="hint">
              Le nom de la machine ou de la personne — c’est ce qui permettra de savoir quoi
              révoquer.
            </span>
          </div>
        </ActionForm>
      </section>

      <section className="card stack">
        <h2>Configurer un client</h2>
        <p className="muted">
          Dans le panneau du client Electron, renseignez l’URL du serveur et collez la clé. Elle
          part ensuite dans l’en-tête <code>{API_KEY_HEADER}</code> de chaque requête.
        </p>
        <code className="secret">{publicUrl()}</code>
      </section>
    </div>
  )
}
