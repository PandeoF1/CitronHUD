import { useEffect, useRef, useState } from 'react'
import type { HudState } from '@citronhud/contracts'

/**
 * Le pépin — élément signature du HUD.
 *
 * Séparateur entre les deux scores. Ce n'est pas un ornement : c'est le point
 * du HUD que le spectateur fixe le plus longtemps, donc celui qui doit porter
 * de l'information plutôt qu'en occuper la place.
 *
 *  - au repos     : deux pépins sombres, inertes ;
 *  - manche gagnée: il pulse et s'incline vers le vainqueur ;
 *  - bombe posée  : il se vide de haut en bas, comme un sablier.
 */

interface PipProps {
  hud: HudState
}

const WIN_ANIMATION_MS = 640
/** Durée du compte à rebours de la bombe en CS2. */
const BOMB_FUSE_SECONDS = 40

export function Pip({ hud }: PipProps) {
  const [lean, setLean] = useState<'left' | 'right' | null>(null)
  const previousScore = useRef<{ left: number; right: number } | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const leftScore = hud.teams.left.score
  const rightScore = hud.teams.right.score

  useEffect(() => {
    const previous = previousScore.current
    previousScore.current = { left: leftScore, right: rightScore }

    // Premier rendu : on enregistre sans animer, sinon le HUD « gagne » une
    // manche à chaque rechargement de la source navigateur.
    if (!previous) return

    let winner: 'left' | 'right' | null = null
    if (leftScore > previous.left) winner = 'left'
    else if (rightScore > previous.right) winner = 'right'
    if (!winner) return

    setLean(winner)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => setLean(null), WIN_ANIMATION_MS)
  }, [leftScore, rightScore])

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
    },
    []
  )

  const bomb = hud.bomb
  const bombPlanted = bomb?.state === 'planted' || bomb?.state === 'defusing'
  const bombProgress =
    bombPlanted && bomb?.countdown !== null && bomb?.countdown !== undefined
      ? Math.max(0, Math.min(100, (bomb.countdown / BOMB_FUSE_SECONDS) * 100))
      : 100

  const live = hud.phase === 'live'

  return (
    <div
      className={`pip${lean ? ' anim-pip-win' : ''}`}
      data-lean={lean ?? undefined}
      data-live={live}
      data-bomb={bombPlanted}
      style={{ ['--bomb-progress' as string]: `${bombProgress}%` }}
      aria-hidden="true"
    >
      <span className="pip__seed" />
    </div>
  )
}
