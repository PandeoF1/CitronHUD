import type { HudPlayer } from '@citronhud/contracts'
import { healthColor, initials } from '../lib/format'

/**
 * Panneau du joueur observé.
 *
 * Le seul endroit du HUD où l'on peut être généreux en taille : le spectateur
 * suit ce joueur, il veut son nom, sa vie, son arme et sa forme du moment.
 */

interface ObservedPanelProps {
  player: HudPlayer
  showAvatar: boolean
}

function Stat({ value, label }: { value: string | number; label: string }) {
  return (
    <div className="stat">
      <span className="stat__value">{value}</span>
      <span className="stat__label">{label}</span>
    </div>
  )
}

export function ObservedPanel({ player, showAvatar }: ObservedPanelProps) {
  const hpColor = player.alive ? healthColor(player.health) : 'var(--ink-rind-dim)'
  const active = player.weapons.find(
    (weapon) => weapon.state === 'active' || weapon.state === 'reloading'
  )

  return (
    <div className="observed plate" style={{ ['--hp-color' as string]: hpColor }}>
      {showAvatar && (
        <div className="observed__avatar plate">
          {player.avatarUrl ? (
            <img src={player.avatarUrl} alt="" />
          ) : (
            <div className="player__initials">{initials(player.name)}</div>
          )}
        </div>
      )}

      <div className="observed__identity">
        <div className="observed__name">{player.name}</div>
        {player.realName && <div className="observed__real">{player.realName}</div>}
      </div>

      <div className="observed__center">
        <div className="observed__vitals">
          <span className="observed__hp tnum">{player.alive ? player.health : 0}</span>
          {player.armor > 0 && (
            <span className="observed__armor tnum">
              {player.armor}
              {player.helmet ? ' ⌂' : ''}
            </span>
          )}
        </div>

        {active && (
          <div className="observed__weapon">
            <span className="observed__weapon-name">{active.label}</span>
            {/*
             * Les munitions n'existent pas pour un couteau ni pour un utilitaire :
             * afficher « null/null » serait pire que ne rien afficher.
             */}
            {active.ammoClip !== null && (
              <span className="observed__ammo tnum">
                <b>{active.ammoClip}</b>
                {active.ammoReserve !== null ? ` / ${active.ammoReserve}` : ''}
              </span>
            )}
          </div>
        )}
      </div>

      <div className="observed__stats">
        <Stat value={player.stats.kills} label="K" />
        <Stat value={player.stats.assists} label="A" />
        <Stat value={player.stats.deaths} label="D" />
        <Stat value={Math.round(player.stats.adr)} label="ADR" />
        <Stat value={`${Math.round(player.stats.headshotPercent)}%`} label="HS" />
      </div>
    </div>
  )
}
