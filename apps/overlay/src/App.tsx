import { useEffect } from 'react'
import { useOverlay } from './state/store'
import { MatchBar } from './components/MatchBar'
import { Roster } from './components/Roster'
import { ObservedPanel } from './components/ObservedPanel'
import { KillFeed } from './components/KillFeed'
import { Radar } from './components/Radar'
import { ReplayStage } from './components/ReplayStage'
import { RecordToasts } from './components/RecordToasts'
import { ZestField } from './components/ZestField'
import { EventBadge, RoundHistory, SeriesBar, Standby } from './components/Chrome'
import { bySlot, teamColor } from './lib/format'

/**
 * Composition de l'overlay.
 *
 * Ce composant ne décide de rien : le client envoie un état entièrement résolu
 * et on le dessine. La seule logique tolérée ici est de l'agencement — quel
 * bloc à quelle place, et lequel s'efface pendant un replay.
 */

/** Cadence de purge des évènements expirés (kills, records, gerbes). */
const PRUNE_INTERVAL_MS = 250

export function App() {
  const hud = useOverlay((s) => s.hud)
  const config = useOverlay((s) => s.config)
  const connected = useOverlay((s) => s.connected)
  const kills = useOverlay((s) => s.kills)
  const records = useOverlay((s) => s.records)
  const replay = useOverlay((s) => s.replay)
  const bursts = useOverlay((s) => s.bursts)
  const prune = useOverlay((s) => s.prune)

  /*
   * Une horloge unique pour toutes les expirations, plutôt qu'un timer par
   * évènement. Sur un match complet, des centaines de `setTimeout` en vol
   * finissent par peser sur une source navigateur qui partage déjà le CPU avec
   * le jeu et l'encodeur.
   */
  useEffect(() => {
    const timer = setInterval(prune, PRUNE_INTERVAL_MS)
    return () => clearInterval(timer)
  }, [prune])

  const stageStyle = {
    '--hud-scale': config.scale,
    '--hud-offset-y': `${config.offsetY}px`
  } as React.CSSProperties

  if (!hud) {
    return (
      <div className="stage" style={stageStyle}>
        <Standby connected={connected} />
      </div>
    )
  }

  const colors = { ct: config.ctColor, t: config.tColor }
  const leftColor = teamColor(hud.teams.left, colors)
  const rightColor = teamColor(hud.teams.right, colors)

  // Un joueur appartient au bloc gauche si son camp est celui de l'équipe de
  // gauche. La mi-temps est ainsi gérée sans code dédié : les joueurs changent
  // réellement de camp dans le flux, et la répartition suit.
  const leftSide = hud.teams.left.side
  const leftPlayers = hud.players.filter((p) => p.side === leftSide).sort(bySlot)
  const rightPlayers = hud.players.filter((p) => p.side !== leftSide).sort(bySlot)

  /*
   * Pendant un replay, le HUD de jeu s'efface : superposer un scoreboard vivant
   * sur une action passée est le défaut le plus courant des HUDs qui proposent
   * du replay, et il rend la séquence incompréhensible.
   */
  const inReplay = replay !== null

  return (
    <div className="stage" style={stageStyle}>
      {!inReplay && (
        <>
          <EventBadge event={hud.event} />
          <MatchBar hud={hud} config={config} />
          <RoundHistory hud={hud} config={config} />
          <SeriesBar hud={hud} config={config} />

          <Roster side="left" players={leftPlayers} color={leftColor} config={config} />
          <Roster side="right" players={rightPlayers} color={rightColor} config={config} />

          <Radar
            players={hud.players}
            mapName={hud.map?.name ?? null}
            config={config}
            bombPosition={hud.bomb?.position ?? null}
          />

          <KillFeed kills={kills} config={config} />

          {config.showObservedPanel && hud.observed && (
            <ObservedPanel player={hud.observed} showAvatar={config.showPlayerAvatars} />
          )}

          {config.showRecordToasts && <RecordToasts records={records} />}
        </>
      )}

      {inReplay && <ReplayStage replay={replay} />}

      <ZestField
        bursts={bursts}
        intensity={config.zestIntensity}
        enabled={config.zestEffects}
      />
    </div>
  )
}
