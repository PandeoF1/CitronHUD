import type { HudConfig, HudState, ResolvedTeam } from '@citronhud/contracts'
import { Pip } from './Pip'
import { bombClock, clock, initials, phaseLabel, teamColor } from '../lib/format'

/**
 * La matchbar — le quartier de citron en haut de l'écran.
 *
 * Regroupe tout ce que le spectateur doit pouvoir lire sans réfléchir : qui
 * joue, le score, le temps restant. Le chanfrein sur les coins bas donne la
 * forme de quartier et fait converger l'œil vers le centre, là où se trouve le
 * pépin.
 */

interface MatchBarProps {
  hud: HudState
  config: HudConfig
}

function TeamSide({
  team,
  side,
  color
}: {
  team: ResolvedTeam
  side: 'left' | 'right'
  color: string
}) {
  return (
    <div className={`matchbar__team matchbar__team--${side}`}>
      {team.logoUrl ? (
        <img className="matchbar__logo" src={team.logoUrl} alt="" />
      ) : (
        <div className="matchbar__logo matchbar__logo--empty plate ch-xs-all">
          {initials(team.shortName || team.name)}
        </div>
      )}
      <div className="matchbar__identity">
        <div className="matchbar__name">{team.name}</div>
        <div className="matchbar__meta">
          <span className="matchbar__side" style={{ ['--team-color' as string]: color }}>
            {team.side}
          </span>
          {/* Le bonus de défaite n'a de sens qu'en cours de série de défaites. */}
          {team.lossBonus > 0 && <span>série {team.lossBonus}</span>}
          {team.matchPoint && <span>balle de match</span>}
        </div>
      </div>
    </div>
  )
}

export function MatchBar({ hud, config }: MatchBarProps) {
  const colors = { ct: config.ctColor, t: config.tColor }
  const leftColor = teamColor(hud.teams.left, colors)
  const rightColor = teamColor(hud.teams.right, colors)

  const bomb = hud.bomb
  const bombPlanted = bomb?.state === 'planted' || bomb?.state === 'defusing'
  const defuseTooLate = bomb?.defuseTooLate ?? false

  /*
   * Bombe posée : son compte à rebours remplace le chrono de manche. Afficher
   * les deux ferait hésiter le spectateur sur celui qui compte — et c'est
   * toujours celui de la bombe.
   */
  const timeValue = bombPlanted ? bombClock(bomb?.countdown) : clock(hud.map?.phaseEndsIn)

  return (
    <>
      <div
        className="matchbar plate ch-lg-bottom"
        style={{
          ['--left-color' as string]: leftColor,
          ['--right-color' as string]: rightColor
        }}
      >
        <TeamSide team={hud.teams.left} side="left" color={leftColor} />

        <div className="matchbar__center">
          <div
            className="matchbar__score matchbar__score--left tnum"
            data-match-point={hud.teams.left.matchPoint}
          >
            {hud.teams.left.score}
          </div>
          <Pip hud={hud} />
          <div
            className="matchbar__score matchbar__score--right tnum"
            data-match-point={hud.teams.right.matchPoint}
          >
            {hud.teams.right.score}
          </div>
        </div>

        <TeamSide team={hud.teams.right} side="right" color={rightColor} />
      </div>

      <div className="timer plate" data-bomb={bombPlanted} data-too-late={defuseTooLate}>
        <div className="timer__value">{timeValue}</div>
        <div className="timer__label">{phaseLabel(hud.phase, bombPlanted, defuseTooLate)}</div>
      </div>
    </>
  )
}
