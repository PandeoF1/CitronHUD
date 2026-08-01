import { useState } from 'react'
import type { ClientSettings } from '@citronhud/contracts'

/**
 * Réglages — ce qu'on touche une fois.
 *
 * Volontairement derrière un onglet : mélanger ces champs avec la sélection des
 * équipes ferait paraître le client compliqué alors qu'il ne demande rien au
 * quotidien.
 */

interface SettingsPanelProps {
  settings: ClientSettings
  playerCount: number
  onChange: (patch: Partial<ClientSettings>) => void
  onNotice: (message: string) => void
}

export function SettingsPanel({ settings, playerCount, onChange, onNotice }: SettingsPanelProps) {
  const [url, setUrl] = useState(settings.serverUrl)
  const [apiKey, setApiKey] = useState(settings.apiKey)
  const [steamPath, setSteamPath] = useState(settings.steamPath ?? '')
  const [testing, setTesting] = useState(false)

  const test = async (): Promise<void> => {
    setTesting(true)
    const result = await window.citron.testServer(url, apiKey)
    onNotice(result.message)
    setTesting(false)
  }

  const handleBrowseSteamPath = async (): Promise<void> => {
    const selected = await window.citron.selectDirectory()
    if (selected) {
      setSteamPath(selected)
      onChange({ steamPath: selected })
    }
  }

  return (
    <>
      <section className="card">
        <h2 className="card__title">Serveur</h2>
        <p className="card__hint">
          Laissez vide pour travailler entièrement en local : le client gère alors ses équipes tout
          seul et rien ne sort de cette machine.
        </p>

        <div className="field">
          <label htmlFor="server-url">Adresse du serveur</label>
          <input
            id="server-url"
            className="input"
            placeholder="https://hud.citron.gg"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            onBlur={() => onChange({ serverUrl: url })}
          />
        </div>

        <div className="field">
          <label htmlFor="api-key">Clé d’API</label>
          <input
            id="api-key"
            className="input"
            type="password"
            placeholder="Fournie par l’administrateur"
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
            onBlur={() => onChange({ apiKey })}
          />
        </div>

        <div className="actions">
          <button className="btn" onClick={() => void test()} disabled={testing}>
            {testing ? 'Test en cours…' : 'Tester la connexion'}
          </button>
          <button
            className="btn btn--ghost"
            onClick={() => void window.citron.syncNow().then(() => onNotice('Synchronisation lancée.'))}
          >
            Synchroniser maintenant
          </button>
          <span className="muted">{playerCount} joueurs en cache</span>
        </div>
      </section>

      <section className="card">
        <h2 className="card__title">CS2</h2>
        <p className="card__hint">
          Le fichier de configuration est installé automatiquement au premier lancement. Indiquez le chemin
          d’installation de Steam ou de CS2 si le jeu est sur une bibliothèque secondaire ou un dossier personnalisé.
        </p>

        <div className="field">
          <label htmlFor="steam-path">Chemin d’installation CS2 / Steam</label>
          <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
            <input
              id="steam-path"
              className="input"
              style={{ flex: 1 }}
              placeholder="Détecté automatiquement (ex: C:\Program Files (x86)\Steam)"
              value={steamPath}
              onChange={(event) => setSteamPath(event.target.value)}
              onBlur={() => onChange({ steamPath: steamPath.trim() || null })}
            />
            <button
              type="button"
              className="btn btn--ghost"
              onClick={() => void handleBrowseSteamPath()}
            >
              Parcourir…
            </button>
          </div>
        </div>

        <div className="actions">
          <button
            className="btn"
            onClick={() => void window.citron.installGsi().then((r) => onNotice(r.message))}
          >
            Réinstaller la configuration GSI
          </button>
          <span className="muted">Port local : {settings.hudPort}</span>
        </div>
      </section>

      <section className="card">
        <h2 className="card__title">OBS</h2>
        <p className="card__hint">
          Le mot de passe websocket est lu directement dans la configuration d’OBS — vous n’avez rien
          à saisir. Activez simplement le serveur websocket dans OBS (Outils › Paramètres du serveur
          WebSocket).
        </p>
        <div className="actions">
          <button className="btn" onClick={() => void window.citron.reconnectObs()}>
            Reconnecter
          </button>
          <button
            className="btn btn--ghost"
            onClick={() =>
              void window.citron.createObsSource().then(() => onNotice('Source navigateur à jour.'))
            }
          >
            Créer la source dans OBS
          </button>
        </div>

        <label className="check">
          <input
            type="checkbox"
            checked={settings.obs.manageReplayBuffer}
            onChange={(event) =>
              onChange({ obs: { ...settings.obs, manageReplayBuffer: event.target.checked } })
            }
          />
          Activer le tampon de replay au démarrage
        </label>
      </section>

      <section className="card">
        <h2 className="card__title">Replays</h2>
        <div className="field">
          <label htmlFor="capture-mode">Source de capture</label>
          <select
            id="capture-mode"
            className="input"
            value={settings.capture.mode}
            onChange={(event) =>
              onChange({
                capture: {
                  ...settings.capture,
                  mode: event.target.value as ClientSettings['capture']['mode']
                }
              })
            }
          >
            <option value="auto">Automatique — OBS si disponible, sinon capture interne</option>
            <option value="obs">OBS uniquement</option>
            <option value="internal">Capture interne uniquement</option>
            <option value="off">Désactivés</option>
          </select>
        </div>

        <label className="check">
          <input
            type="checkbox"
            checked={settings.autoUpdate}
            onChange={(event) => onChange({ autoUpdate: event.target.checked })}
          />
          Installer les mises à jour automatiquement
        </label>
      </section>
    </>
  )
}
