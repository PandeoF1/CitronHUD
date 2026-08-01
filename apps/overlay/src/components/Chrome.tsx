import type { HudConfig, HudState } from '@citronhud/contracts'

/**
 * Les éléments périphériques de la matchbar.
 *
 * Regroupés dans un même fichier parce qu'ils partagent une seule règle
 * éditoriale : ce sont des informations de CONTEXTE, jamais d'action. Elles
 * doivent pouvoir être lues pendant un temps mort et ignorées pendant un duel.
 */

/** Nom du tournoi et phase — coin haut gauche. */
export function EventBadge({ event }: { event: HudState['event'] }) {
  if (!event.name && !event.stage) return null
  return (
    <div className="event plate">
      {event.name && <div className="event__name">{event.name}</div>}
      {event.stage && <div className="event__stage">{event.stage}</div>}
    </div>
  )
}

/**
 * Frise des manches jouées.
 *
 * Une pastille par manche, colorée par le vainqueur. Le GSI indexe les
 * résultats par numéro de manche sous forme de chaîne (« ct_win_defuse »…) :
 * seul le préfixe nous intéresse pour savoir quel camp l'emporte.
 */
export function RoundHistory({ hud, config }: { hud: HudState; config: HudConfig }) {
  if (!config.showRoundHistory || !hud.map) return null

  const entries = Object.entries(hud.map.roundWins)
    .map(([round, outcome]) => ({ round: Number(round), outcome }))
    .filter((entry) => Number.isFinite(entry.round))
    .sort((a, b) => a.round - b.round)

  if (entries.length === 0) return null

  const leftSide = hud.sides.leftSide

  return (
    <div
      className="rounds"
      style={
        {
          '--left-color': leftSide === 'CT' ? config.ctColor : config.tColor,
          '--right-color': leftSide === 'CT' ? config.tColor : config.ctColor
        } as React.CSSProperties
      }
      aria-hidden="true"
    >
      {entries.map(({ round, outcome }) => {
        const winnerSide = outcome.startsWith('ct_') ? 'CT' : 'T'
        return (
          <span
            key={round}
            className="rounds__tick"
            data-winner={winnerSide === leftSide ? 'left' : 'right'}
          />
        )
      })}
    </div>
  )
}

/** Cartes de la série, avec leur score — masqué en BO1, où il n'apprend rien. */
export function SeriesBar({ hud, config }: { hud: HudState; config: HudConfig }) {
  if (!config.showSeriesBar) return null
  if (hud.series.format === 'bo1') return null
  if (hud.series.maps.length === 0) return null

  return (
    <div className="series">
      {hud.series.maps.map((map) => (
        <div key={map.mapName} className="series__map plate" data-played={map.played || undefined}>
          <span>{map.label}</span>
          {map.left !== null && map.right !== null && (
            <span className="series__score">
              {map.left}–{map.right}
            </span>
          )}
        </div>
      ))}
    </div>
  )
}

/**
 * Écran d'attente.
 *
 * Visible uniquement hors antenne : dès qu'une trame GSI arrive, le HUD prend
 * sa place. Il sert au streamer qui vient de coller l'URL dans OBS et se
 * demande si ça marche — sans lui, une source navigateur transparente et une
 * source cassée sont indiscernables.
 */
export function Standby({ connected }: { connected: boolean }) {
  return (
    <div className="standby plate">
      <div className="standby__mark" aria-hidden="true">
        🍋
      </div>
      <div className="standby__title">CitronHUD</div>
      <p className="standby__hint">
        {connected
          ? 'Connecté au client. En attente des données de CS2 — lancez une partie ou une démo.'
          : "Pas de liaison avec le client CitronHUD. Vérifiez qu'il est bien lancé."}
      </p>
    </div>
  )
}
