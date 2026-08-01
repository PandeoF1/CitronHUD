import type { HudConfig } from '@citronhud/contracts'
import type { TimedKill } from '../state/store'

/**
 * Le killfeed.
 *
 * Reconstruit côté client par comparaison de trames — CS2 n'expose aucun
 * killfeed via le GSI. On n'affiche donc que ce qui est réellement déductible :
 * tueur, arme active, victime, headshot. Pas de wallbang ni de noscope, que le
 * flux ne permet pas de connaître honnêtement.
 */

interface KillFeedProps {
  kills: TimedKill[]
  config: HudConfig
}

function sideColor(side: 'CT' | 'T', config: HudConfig): string {
  return side === 'CT' ? config.ctColor : config.tColor
}

export function KillFeed({ kills, config }: KillFeedProps) {
  if (!config.showKillfeed || kills.length === 0) return null

  return (
    <div className="killfeed">
      {kills.map((kill) => (
        <div
          key={kill.id}
          className="kill plate"
          data-teamkill={kill.teamkill || undefined}
          style={
            {
              '--kill-color': kill.killer
                ? sideColor(kill.killer.side, config)
                : 'var(--ink-rind-dim)'
            } as React.CSSProperties
          }
        >
          {/* Un suicide n'a pas de tueur : on ne fabrique pas un nom vide. */}
          {kill.killer && (
            <span className="kill__name kill__name--killer">{kill.killer.name}</span>
          )}

          {kill.assister && (
            <span className="kill__name kill__name--victim">+ {kill.assister.name}</span>
          )}

          <span className="kill__weapon">
            {kill.suicide ? 'suicide' : (kill.weaponLabel ?? '—')}
          </span>

          {kill.headshot && (
            <span className="kill__hs" title="Headshot">
              ◎
            </span>
          )}

          <span
            className="kill__name kill__name--victim"
            style={{ color: sideColor(kill.victim.side, config) }}
          >
            {kill.victim.name}
          </span>
        </div>
      ))}
    </div>
  )
}
