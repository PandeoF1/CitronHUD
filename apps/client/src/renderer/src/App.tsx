import { useEffect, useState } from 'react'
import type {
  ClientSettings,
  ConnectionStatus,
  HudState,
  MatchSetup,
  Player,
  Slot,
  Team,
  TeamSlot
} from '@citronhud/contracts'
import { TeamPicker } from './components/TeamPicker'
import { StatusStrip } from './components/StatusStrip'
import { SidesCard } from './components/SidesCard'
import { SettingsPanel } from './components/SettingsPanel'

/**
 * Le panneau de contrôle.
 *
 * Règle de conception : ce que le streamer fait à CHAQUE diffusion est visible
 * immédiatement — choisir deux équipes, vérifier les camps, copier l'URL. Ce
 * qu'il règle UNE FOIS (serveur, ports, OBS) est derrière un onglet. Mettre les
 * deux au même niveau est ce qui rend les outils de production intimidants.
 */

type Tab = 'live' | 'settings'

export function App() {
  const [status, setStatus] = useState<ConnectionStatus | null>(null)
  const [state, setState] = useState<HudState | null>(null)
  const [match, setMatch] = useState<MatchSetup | null>(null)
  const [settings, setSettings] = useState<ClientSettings | null>(null)
  const [teams, setTeams] = useState<Team[]>([])
  const [players, setPlayers] = useState<Player[]>([])
  const [notice, setNotice] = useState<string | null>(null)
  const [tab, setTab] = useState<Tab>('live')

  useEffect(() => {
    void window.citron.getStatus().then(setStatus)
    void window.citron.getMatch().then(setMatch)
    void window.citron.getSettings().then(setSettings)
    void window.citron.getRoster().then(({ teams: t, players: p }) => {
      setTeams(t)
      setPlayers(p)
    })

    const offStatus = window.citron.onStatus(setStatus)
    const offState = window.citron.onState(setState)
    const offNotice = window.citron.onNotice(setNotice)
    return () => {
      offStatus()
      offState()
      offNotice()
    }
  }, [])

  // Le roster arrive par synchronisation : on le recharge quand le serveur
  // repasse en ligne plutôt que d'interroger en boucle.
  useEffect(() => {
    if (status?.server !== 'online') return
    void window.citron.getRoster().then(({ teams: t, players: p }) => {
      setTeams(t)
      setPlayers(p)
    })
  }, [status?.server])

  const assignTeam = async (slot: Slot, team: TeamSlot): Promise<void> => {
    setMatch(await window.citron.setTeam(slot, team))
  }

  if (!status || !match || !settings) {
    return (
      <div className="boot">
        <span className="boot__mark">🍋</span>
        <p>Démarrage…</p>
      </div>
    )
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand__mark" aria-hidden="true">
            🍋
          </span>
          <span className="brand__name">CitronHUD</span>
        </div>

        <nav className="tabs" role="tablist">
          <button
            role="tab"
            aria-selected={tab === 'live'}
            className="tab"
            data-active={tab === 'live'}
            onClick={() => setTab('live')}
          >
            Diffusion
          </button>
          <button
            role="tab"
            aria-selected={tab === 'settings'}
            className="tab"
            data-active={tab === 'settings'}
            onClick={() => setTab('settings')}
          >
            Réglages
          </button>
        </nav>

        <button
          className="btn btn--primary"
          onClick={() => void window.citron.copyOverlayUrl().then(() => setNotice('URL copiée.'))}
        >
          Copier l’URL de l’overlay
        </button>
      </header>

      <StatusStrip status={status} />

      {notice && (
        <div className="notice" role="status">
          <span>{notice}</span>
          <button className="notice__close" onClick={() => setNotice(null)} aria-label="Fermer">
            ×
          </button>
        </div>
      )}

      <main className="content">
        {tab === 'live' ? (
          <>
            <section className="card">
              <h2 className="card__title">Équipes</h2>
              <p className="card__hint">
                Choisissez une équipe du roster, ou tapez un nom à la volée si elle n’y est pas
                encore.
              </p>
              <div className="teams">
                <TeamPicker
                  slot="left"
                  value={match.left}
                  teams={teams}
                  onChange={(team) => void assignTeam('left', team)}
                />
                <button
                  className="btn btn--ghost swap"
                  title="Échanger les équipes de position à l’écran"
                  onClick={() => void window.citron.swapTeams().then(setMatch)}
                >
                  ⇄
                </button>
                <TeamPicker
                  slot="right"
                  value={match.right}
                  teams={teams}
                  onChange={(team) => void assignTeam('right', team)}
                />
              </div>
            </section>

            <SidesCard
              match={match}
              state={state}
              onSwap={() => void window.citron.swapSides().then(setMatch)}
              onModeChange={(mode) => void window.citron.setSideMode(mode).then(setMatch)}
            />

            <section className="card">
              <h2 className="card__title">Antenne</h2>
              <div className="actions">
                <button className="btn" onClick={() => void window.citron.reloadOverlay()}>
                  Recharger l’overlay
                </button>
                <button className="btn" onClick={() => void window.citron.burstZest('center')}>
                  Lancer des zestes 🍋
                </button>
                <button className="btn" onClick={() => void window.citron.cancelReplay()}>
                  Couper le replay
                </button>
                <button
                  className="btn"
                  onClick={() => void window.citron.resetMatch(true).then(setMatch)}
                >
                  Nouveau match
                </button>
              </div>
            </section>
          </>
        ) : (
          <SettingsPanel
            settings={settings}
            playerCount={players.length}
            onChange={(patch) => void window.citron.updateSettings(patch).then(setSettings)}
            onNotice={setNotice}
          />
        )}
      </main>
    </div>
  )
}
