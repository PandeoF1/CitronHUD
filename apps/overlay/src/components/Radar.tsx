import { useEffect, useRef, useState } from 'react'
import type { HudConfig, HudGrenade, HudPlayer } from '@citronhud/contracts'
import {
  interpolateSnapshots,
  loadRadarGeometries,
  projectToRadar,
  radarGeometry,
  radarImageUrl,
  RADAR_IMAGE_SIZE,
  type RadarGeometry,
  type RadarSnapshot,
  type Vec3
} from '../lib/radar'

/**
 * Le radar.
 *
 * Dessiné sur canvas plutôt qu'en DOM : dix pastilles repositionnées dix fois
 * par seconde produisent cent recalculs de style par seconde en DOM, ce qui se
 * voit sur une source navigateur qui partage le CPU avec le jeu et l'encodeur.
 *
 * Le rendu tourne en boucle d'animation et non au rythme des trames GSI. CS2
 * n'envoie qu'une dizaine d'états par seconde ; recopiés tels quels, les
 * déplacements sont saccadés à côté d'un jeu à 60 images par seconde. On
 * interpole donc entre le dernier état connu et l'avant-dernier.
 *
 * Quand l'image de la carte manque (carte communautaire, ressources non
 * installées), on affiche un repli explicite. Un cadre vide serait lu comme un
 * bug par le streamer.
 */

interface RadarProps {
  players: HudPlayer[]
  grenades: HudGrenade[]
  mapName: string | null
  config: HudConfig
  bombPosition: readonly [number, number, number] | null
}

const BASE_SIZE = 260

/** Couleurs des utilitaires — indépendantes du camp, comme dans le jeu. */
const GRENADE_COLORS: Record<HudGrenade['type'], string> = {
  smoke: '#d8dde3',
  flash: '#ffe27a',
  frag: '#7ee08a',
  decoy: '#b9a0e8',
  incendiary: '#ff7a3c'
}

export function Radar({ players, grenades, mapName, config, bombPosition }: RadarProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const imageRef = useRef<HTMLImageElement | null>(null)
  const [geometries, setGeometries] = useState<Record<string, RadarGeometry> | null>(null)

  /*
   * Deux instantanés suffisent : celui qu'on quitte et celui qu'on rejoint.
   * Conserver un historique plus long n'améliorerait rien et ferait dériver le
   * radar du reste du HUD, qui lui affiche l'état courant.
   */
  const framesRef = useRef<[RadarSnapshot | null, RadarSnapshot | null]>([null, null])

  /* Les données de la trame courante, lues par la boucle d'animation. */
  const playersRef = useRef(players)
  const grenadesRef = useRef(grenades)
  const configRef = useRef(config)
  playersRef.current = players
  grenadesRef.current = grenades
  configRef.current = config

  const geometry = geometries ? radarGeometry(mapName, geometries) : null
  const size = Math.round(BASE_SIZE * config.radarScale)

  useEffect(() => {
    let cancelled = false
    loadRadarGeometries().then((loaded) => {
      if (!cancelled) setGeometries(loaded)
    })
    return () => {
      cancelled = true
    }
  }, [])

  // Enregistre chaque nouvel état comme instantané interpolable.
  useEffect(() => {
    const positions = new Map<string, Vec3>()
    for (const player of players) {
      if (player.position) positions.set(player.steamId, player.position)
    }
    const [, latest] = framesRef.current
    framesRef.current = [latest, { at: performance.now(), positions, bomb: bombPosition }]
  }, [players, bombPosition])

  /*
   * Altitude du joueur observé : elle décide de l'étage affiché sur les cartes à
   * deux niveaux. À défaut d'observé, on prend la médiane des vivants — mieux
   * vaut suivre la majorité de l'action qu'un joueur isolé en contrebas.
   */
  const altitude = floorAltitude(players)
  const imageUrl = geometry ? radarImageUrl(geometry, altitude) : null

  useEffect(() => {
    imageRef.current = null
    if (!imageUrl) return

    const image = new Image()
    let cancelled = false
    image.onload = () => {
      if (!cancelled) imageRef.current = image
    }
    image.onerror = () => {
      // Volontairement silencieux : l'absence d'image laisse le canvas dessiner
      // les pastilles sur fond neutre, ce qui reste utilisable à l'antenne.
    }
    image.src = imageUrl

    return () => {
      cancelled = true
    }
  }, [imageUrl])

  // Boucle de rendu — indépendante de la cadence d'arrivée des trames.
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !geometry) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    let frame = 0
    const draw = (): void => {
      frame = requestAnimationFrame(draw)
      paint(ctx, {
        size,
        geometry,
        config: configRef.current,
        players: playersRef.current,
        grenades: grenadesRef.current,
        image: imageRef.current,
        interpolated: configRef.current.smoothRadar
          ? interpolateSnapshots(framesRef.current[0], framesRef.current[1], performance.now())
          : null
      })
    }

    frame = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(frame)
  }, [geometry, size])

  if (!config.showRadar) return null

  if (!geometry) {
    return (
      <div className="radar plate" style={{ width: size, height: size }}>
        <div className="radar__fallback">
          <strong>{geometries ? 'Radar indisponible' : 'Chargement du radar…'}</strong>
          {geometries && (
            <span>
              Aucune géométrie connue pour cette carte. Le reste du HUD fonctionne normalement.
            </span>
          )}
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

/**
 * Altitude de référence pour choisir l'étage.
 *
 * Le joueur observé fait autorité : c'est son action qu'on commente. Sans
 * observé — replay, caméra libre — on retombe sur la médiane des vivants.
 */
function floorAltitude(players: readonly HudPlayer[]): number | null {
  const observed = players.find((player) => player.isObserved && player.position)
  if (observed?.position) return observed.position[2]

  const altitudes = players
    .filter((player) => player.alive && player.position)
    .map((player) => player.position![2])
    .sort((a, b) => a - b)

  if (altitudes.length === 0) return null
  return altitudes[Math.floor(altitudes.length / 2)]!
}

interface PaintOptions {
  size: number
  geometry: RadarGeometry
  config: HudConfig
  players: readonly HudPlayer[]
  grenades: readonly HudGrenade[]
  /** Fond de carte, `null` tant qu'il n'est pas chargé. */
  image: HTMLImageElement | null
  interpolated: { positions: Map<string, Vec3>; bomb: Vec3 | null } | null
}

function paint(ctx: CanvasRenderingContext2D, options: PaintOptions): void {
  const { size, geometry, config, players, grenades, image, interpolated } = options
  const canvas = ctx.canvas

  const dpr = window.devicePixelRatio || 1
  if (canvas.width !== Math.round(size * dpr)) {
    canvas.width = Math.round(size * dpr)
    canvas.height = Math.round(size * dpr)
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, size, size)

  const to = (position: Vec3): [number, number] => {
    const { x, y } = projectToRadar(position, geometry)
    return [x * size, y * size]
  }
  /** Convertit un rayon monde en rayon écran. */
  const scaleRadius = (world: number): number =>
    (world / geometry.scale / RADAR_IMAGE_SIZE) * size

  if (image) {
    ctx.globalAlpha = 0.55
    ctx.drawImage(image, 0, 0, size, size)
    ctx.globalAlpha = 1
  }

  if (config.showGrenades) paintGrenades(ctx, grenades, to, scaleRadius)

  const ctColor = config.ctColor
  const tColor = config.tColor

  // La bombe d'abord, pour qu'un joueur posté dessus reste visible au-dessus.
  const bomb = interpolated ? interpolated.bomb : null
  if (bomb) {
    const [x, y] = to(bomb)
    ctx.fillStyle = '#FF3B30'
    ctx.beginPath()
    ctx.arc(x, y, 4, 0, Math.PI * 2)
    ctx.fill()
  }

  for (const player of players) {
    const position = interpolated?.positions.get(player.steamId) ?? player.position
    if (!position) continue

    const [px, py] = to(position)
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
}

/**
 * Utilitaires : nappes de feu, fumées, puis projectiles et traînées.
 *
 * Les zones passent sous les pastilles de joueurs — le radar sert d'abord à
 * situer les gens, l'utilitaire est du contexte. Les traînées sont ce qui fait
 * la lecture : voir d'où part un smoke explique la manche mieux que le voir
 * arriver.
 */
function paintGrenades(
  ctx: CanvasRenderingContext2D,
  grenades: readonly HudGrenade[],
  to: (position: Vec3) => [number, number],
  scaleRadius: (world: number) => number
): void {
  for (const grenade of grenades) {
    const color = GRENADE_COLORS[grenade.type]

    // Les foyers se chevauchent largement : une opacité faible suffit à faire
    // ressortir la nappe sans transformer chaque foyer en pastille opaque.
    for (const flame of grenade.flames) {
      const [x, y] = to(flame)
      ctx.fillStyle = color
      ctx.globalAlpha = 0.3
      ctx.beginPath()
      ctx.arc(x, y, scaleRadius(grenade.flameRadius), 0, Math.PI * 2)
      ctx.fill()
    }

    if (grenade.active && grenade.radius > 0 && grenade.position) {
      const [x, y] = to(grenade.position)
      const radius = scaleRadius(grenade.radius)
      ctx.fillStyle = color
      ctx.globalAlpha = 0.35
      ctx.beginPath()
      ctx.arc(x, y, radius, 0, Math.PI * 2)
      ctx.fill()
      ctx.globalAlpha = 0.7
      ctx.strokeStyle = color
      ctx.lineWidth = 1
      ctx.stroke()
    }

    if (grenade.trail.length > 1) {
      ctx.strokeStyle = color
      ctx.globalAlpha = 0.5
      ctx.lineWidth = 1.5
      ctx.beginPath()
      grenade.trail.forEach((point, index) => {
        const [x, y] = to(point)
        if (index === 0) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
      })
      ctx.stroke()
    }

    // Le projectile lui-même, tant qu'il n'a pas laissé d'effet au sol.
    if (!grenade.active && grenade.flames.length === 0 && grenade.position) {
      const [x, y] = to(grenade.position)
      ctx.fillStyle = color
      ctx.globalAlpha = 0.9
      ctx.beginPath()
      ctx.arc(x, y, 2.5, 0, Math.PI * 2)
      ctx.fill()
    }

    ctx.globalAlpha = 1
  }
}
