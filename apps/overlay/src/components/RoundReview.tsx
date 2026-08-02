import { useEffect, useState } from 'react'
import type { HudConfig, HudState, RoundEndReason, RoundReview as Review } from '@citronhud/contracts'
import { initials } from '../lib/format'

/**
 * Bilan de fin de manche.
 *
 * Le moment où le spectateur a le plus besoin d'aide : l'action vient de
 * s'arrêter, et il lui manque le pourquoi. On répond dans l'ordre où la question
 * se pose — qui a gagné, comment, grâce à qui, puis où en est chacun.
 *
 * Le bilan s'efface de lui-même avant la fin du temps de gel : les achats du
 * tour suivant sont eux aussi du contenu, et un panneau qui reste affiché
 * jusqu'au dernier moment donne l'impression d'un HUD figé.
 */

interface RoundReviewProps {
  review: Review
  teams: HudState['teams']
  config: HudConfig
}

const REASON_LABELS: Record<RoundEndReason, string> = {
  elimination: 'Élimination',
  bomb: 'Explosion',
  defuse: 'Désamorçage',
  time: 'Temps écoulé',
  rescue: 'Otages libérés',
  unknown: 'Manche remportée'
}

export function RoundReview({ review, teams, config }: RoundReviewProps) {
  const [visible, setVisible] = useState(true)

  /*
   * L'effacement est piloté par le numéro de manche et non par l'objet : le
   * bilan est réémis à chaque trame pendant la phase « over », et une dépendance
   * sur l'objet relancerait le minuteur en boucle sans jamais l'échoir.
   */
  useEffect(() => {
    setVisible(true)
    if (config.roundReviewMs <= 0) return
    const timer = setTimeout(() => setVisible(false), config.roundReviewMs)
    return () => clearTimeout(timer)
  }, [review.round, config.roundReviewMs])

  if (!visible) return null

  const winner = review.winnerSlot === 'left' ? teams.left : teams.right
  const left = review.players.filter((player) => player.slot === 'left').sort(byImpact)
  const right = review.players.filter((player) => player.slot === 'right').sort(byImpact)

  return (
    <div className="review">
      <div className="review__head plate">
        <span className="review__round">Manche {review.round}</span>
        <strong className="review__winner" style={{ color: winner.color ?? undefined }}>
          {winner.name}
        </strong>
        <span className="review__reason">{REASON_LABELS[review.reason]}</span>
        <span className="review__score">
          {review.score.left} — {review.score.right}
        </span>
      </div>

      {review.mvp && (
        <div className="review__mvp plate">
          {review.mvp.avatarUrl ? (
            <img className="review__avatar" src={review.mvp.avatarUrl} alt="" />
          ) : (
            <div className="review__avatar" aria-hidden="true">
              {initials(review.mvp.name)}
            </div>
          )}
          <div className="col">
            <span className="review__label">Joueur de la manche</span>
            <strong className="review__name">{review.mvp.name}</strong>
            <span className="review__detail">
              {review.mvp.reason} · {Math.round(review.mvp.damage)} dégâts
            </span>
          </div>
        </div>
      )}

      <div className="review__boards">
        <ReviewBoard players={left} title={teams.left.shortName} config={config} />
        <ReviewBoard players={right} title={teams.right.shortName} config={config} />
      </div>
    </div>
  )
}

/** Les plus décisifs en haut : trois frags valent mieux que deux, à dégâts égaux. */
function byImpact(a: Review['players'][number], b: Review['players'][number]): number {
  return b.kills - a.kills || b.damage - a.damage
}

interface ReviewBoardProps {
  players: Review['players']
  title: string
  config: HudConfig
}

function ReviewBoard({ players, title, config }: ReviewBoardProps) {
  return (
    <table className="review__board plate">
      <thead>
        <tr>
          <th className="review__team">{title}</th>
          <th title="Frags de la manche">M</th>
          <th title="Kills / assists / morts sur la carte">K/A/D</th>
          {config.showAdr && <th title="Dégâts moyens par manche">ADR</th>}
        </tr>
      </thead>
      <tbody>
        {players.map((player) => (
          <tr key={player.steamId} className={player.survived ? '' : 'review__row--dead'}>
            <td className="review__player">{player.name}</td>
            <td className="review__round-kills">{player.kills > 0 ? player.kills : '—'}</td>
            <td>
              {player.totalKills}/{player.totalAssists}/{player.totalDeaths}
            </td>
            {config.showAdr && <td>{Math.round(player.adr)}</td>}
          </tr>
        ))}
      </tbody>
    </table>
  )
}
