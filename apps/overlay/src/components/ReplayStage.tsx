import { useEffect, useRef, useState } from 'react'
import { HIGHLIGHT_LABEL } from '@citronhud/contracts'
import type { ActiveReplay } from '../state/store'
import { notifyReplayEnded } from '../state/socket'

/**
 * La scène de replay — le moment signature du HUD.
 *
 * Le « squeeze » : l'écran se fait trancher par une arête zeste, puis le cadre
 * s'ouvre en s'étirant depuis cette coupe. C'est la métaphore du citron qu'on
 * presse, appliquée au seul instant où une animation appuyée est justifiée.
 *
 * On sort par une animation de fermeture explicite plutôt qu'en démontant le
 * composant d'un coup : un replay qui disparaît sans transition ressemble à un
 * plantage à l'antenne.
 */

interface ReplayStageProps {
  replay: ActiveReplay
}

const EXIT_MS = 380

export function ReplayStage({ replay }: ReplayStageProps) {
  const [leaving, setLeaving] = useState(false)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const exitTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const { highlight, clipUrl, durationMs } = replay

  // Garde-fou de durée : si la vidéo ne signale jamais sa fin (fichier
  // tronqué, codec récalcitrant), le HUD doit reprendre la main tout seul.
  useEffect(() => {
    const cap = setTimeout(() => setLeaving(true), durationMs + 600)
    return () => clearTimeout(cap)
  }, [durationMs, highlight.id])

  useEffect(() => {
    if (!leaving) return
    exitTimer.current = setTimeout(() => notifyReplayEnded(highlight.id), EXIT_MS)
    return () => {
      if (exitTimer.current) clearTimeout(exitTimer.current)
    }
  }, [leaving, highlight.id])

  const victimCount = highlight.victims.length

  return (
    <div className="replay">
      {/* La coupe : trait vertical qui précède l'ouverture du cadre. */}
      {!leaving && <div className="replay__slice" aria-hidden="true" />}

      <div className="replay__frame plate" data-leaving={leaving || undefined}>
        <video
          ref={videoRef}
          className="replay__video"
          src={clipUrl}
          autoPlay
          muted
          playsInline
          onEnded={() => setLeaving(true)}
          onError={() => setLeaving(true)}
        />

        <div className="replay__plate plate">
          <span className="replay__kind">{HIGHLIGHT_LABEL[highlight.kind]}</span>
          <span className="replay__player">{highlight.playerName}</span>
        </div>

        <div className="replay__meta">
          <span>Manche {highlight.round}</span>
          {victimCount > 0 && <span>{victimCount} kills</span>}
          {highlight.headshots > 0 && <span>{highlight.headshots} HS</span>}
          {highlight.clutchAgainst !== null && <span>1 v {highlight.clutchAgainst}</span>}
        </div>
      </div>
    </div>
  )
}
