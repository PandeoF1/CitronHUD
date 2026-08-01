import type { HudConfig, HudPlayer } from '@citronhud/contracts'
import { bySlot, grenadeColor, healthColor, initials, money } from '../lib/format'

/**
 * Les listes de joueurs, sur les bords gauche et droit.
 *
 * Densité maximale, bruit minimal : cinq lignes qu'on doit pouvoir balayer d'un
 * coup d'œil pendant l'action. Tout ce qui n'aide pas à répondre à « qui est en
 * vie, avec combien de vie, et avec quoi » a été écarté.
 */

interface RosterProps {
  side: 'left' | 'right'
  players: HudPlayer[]
  color: string
  config: HudConfig
}

function PlayerRow({
  player,
  side,
  color,
  config
}: {
  player: HudPlayer
  side: 'left' | 'right'
  color: string
  config: HudConfig
}) {
  const hpColor = player.alive ? healthColor(player.health) : 'var(--ink-rind-dim)'

  const avatar = (
    <div className="player__avatar plate">
      {config.showPlayerAvatars && player.avatarUrl ? (
        <img src={player.avatarUrl} alt="" />
      ) : (
        <div className="player__initials">{initials(player.name)}</div>
      )}
      <span className="player__slot" style={{ ['--team-color' as string]: color }}>
        {player.observerSlot}
      </span>
    </div>
  )

  const equipment = (
    <div className="player__equipment">
      {player.defuseKit && player.side === 'CT' && <span className="player__kit" title="Kit" />}
      {player.grenades.map((grenade) =>
        Array.from({ length: grenade.count }, (_, index) => (
          <span
            key={`${grenade.name}-${index}`}
            className="player__nade"
            style={{ background: grenadeColor(grenade.name) }}
            title={grenade.label}
          />
        ))
      )}
    </div>
  )

  return (
    <div
      className="player plate"
      data-alive={player.alive}
      data-observed={player.isObserved}
      style={{
        ['--hp-color' as string]: hpColor,
        ['--hp-pct' as string]: `${player.health}%`,
        ['--team-color' as string]: color
      }}
    >
      <span className="player__hpbar">
        <span />
      </span>

      {side === 'left' ? avatar : equipment}

      <div className="player__body">
        <div className="player__nameline">
          <span className="player__name">{player.name}</span>
          <span className="player__hp tnum">{player.alive ? player.health : '☠'}</span>
        </div>
        <div className="player__stats">
          <span>
            {player.stats.kills}/{player.stats.assists}/{player.stats.deaths}
          </span>
          {config.showAdr && <span>{Math.round(player.stats.adr)} ADR</span>}
          {config.showMoney && player.alive && (
            <span className="player__money">{money(player.money)}</span>
          )}
        </div>
      </div>

      {side === 'left' ? equipment : avatar}
    </div>
  )
}

export function Roster({ side, players, color, config }: RosterProps) {
  return (
    <div className={`roster roster--${side}`}>
      {[...players].sort(bySlot).map((player) => (
        <PlayerRow
          key={player.steamId}
          player={player}
          side={side}
          color={color}
          config={config}
        />
      ))}
    </div>
  )
}
