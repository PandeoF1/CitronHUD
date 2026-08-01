import { useEffect, useRef, useState } from 'react'
import type { HudConfig, HudPlayer } from '@citronhud/contracts'
import { projectToRadar, radarGeometry, radarImageUrl } from '../lib/radar'

/**
 * Le radar.
 *
 * Dessiné sur canvas plutôt qu'en DOM : dix pastilles repositionnées dix fois
 * par seconde produisent cent recalculs de style par seconde en DOM, ce qui se
 * voit sur une source navigateur qui partage le CPU avec le jeu et l'encodeur.
 *
 * Quand l'image de la carte manque (carte communautaire, ressources non
 * installées), on affiche un repli explicite. Un cadre vide serait lu comme un
 * bug par le streamer.
 */

interface RadarProps {
  players: HudPlayer[]
  mapName: string | null
  config: HudConfig
  bombPosition: readonly [number, number, number] | null
}

const BASE_SIZE = 260

export function Radar({ players, mapName, config, bombPosition }: RadarProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const imageRef = useRef<HTMLImageElement | null>(null)
  const [imageReady, setImageReady] = useState(false)

  const geometry = radarGeometry(mapName)
  const size = Math.round(BASE_SIZE * config.radarScale)

  // Chargement de l'image de carte — relancé à chaque changement de map.
  useEffect(() => {
    setImageReady(false)
    imageRef.current = null

    const url = radarImageUrl(mapName)
    if (!url || !geometry) return

    const image = new Image()
    let cancelled = false
    image.onload = () => {
      if (cancelled) return
      imageRef.current = image
      setImageReady(true)
    }
    image.onerror = () => {
      // Volontairement silencieux : l'absence d'image laisse le canvas dessiner
      // les pastilles sur fond neutre, ce qui reste utilisable à l'antenne.
    }
    image.src = url

    return () => {
      cancelled = true
    }
  }, [mapName, geometry])

  // Rendu — redessine à chaque changement de positions.
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !geometry) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const dpr = window.devicePixelRatio || 1
    if (canvas.width !== size * dpr) {
      canvas.width = size * dpr
      canvas.height = size * dpr
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, size, size)

    const image = imageRef.current
    if (image) {
      ctx.globalAlpha = 0.55
      ctx.drawImage(image, 0, 0, size, size)
      ctx.globalAlpha = 1
    }

    const ctColor = config.ctColor
    const tColor = config.tColor

    // La bombe d'abord, pour qu'un joueur posté dessus reste visible au-dessus.
    if (bombPosition) {
      const { x, y } = projectToRadar(bombPosition, geometry)
      ctx.fillStyle = '#FF3B30'
      ctx.beginPath()
      ctx.arc(x * size, y * size, 4, 0, Math.PI * 2)
      ctx.fill()
    }

    for (const player of players) {
      if (!player.position) continue
      const { x, y } = projectToRadar(player.position, geometry)
      const px = x * size
      const py = y * size
      const color = player.side === 'CT' ? ctColor : tColor

      if (!player.alive) {
        // Les morts restent visibles en croix discrète : savoir où quelqu'un
        // est tombé est une information de commentaire, pas du bruit.
        ctx.strokeStyle = color
        ctx.globalAlpha = 0.35
        ctx.lineWidth = 1.5
        ctx.beginPath()
        ctx.moveTo(px - 3, py - 3)
        ctx.lineTo(px + 3, py + 3)
        ctx.moveTo(px + 3, py - 3)
        ctx.lineTo(px - 3, py + 3)
        ctx.stroke()
        ctx.globalAlpha = 1
        continue
      }

      // Cône de visée, seulement pour le joueur observé : dix cônes
      // simultanés saturent le radar sans rien apprendre.
      if (player.isObserved && player.forward) {
        const angle = Math.atan2(-player.forward[1], player.forward[0])
        ctx.fillStyle = color
        ctx.globalAlpha = 0.25
        ctx.beginPath()
        ctx.moveTo(px, py)
        ctx.arc(px, py, 22, angle - 0.42, angle + 0.42)
        ctx.closePath()
        ctx.fill()
        ctx.globalAlpha = 1
      }

      ctx.fillStyle = color
      ctx.beginPath()
      ctx.arc(px, py, player.isObserved ? 6 : 4.5, 0, Math.PI * 2)
      ctx.fill()

      // Le joueur observé porte une couronne zeste : c'est lui qu'on suit.
      if (player.isObserved) {
        ctx.strokeStyle = '#FFC800'
        ctx.lineWidth = 2
        ctx.beginPath()
        ctx.arc(px, py, 8.5, 0, Math.PI * 2)
        ctx.stroke()
      }
    }
  }, [players, geometry, size, config.ctColor, config.tColor, bombPosition, imageReady])

  if (!config.showRadar) return null

  if (!geometry) {
    return (
      <div className="radar plate" style={{ width: size, height: size }}>
        <div className="radar__fallback">
          <strong>Radar indisponible</strong>
          <span>
            Aucune géométrie connue pour cette carte. Le reste du HUD fonctionne normalement.
          </span>
        </div>
      </div>
    )
  }

  return (
    <div className="radar plate" style={{ width: size, height: size }}>
      <canvas ref={canvasRef} className="radar__canvas" style={{ width: size, height: size }} />
    </div>
  )
}
