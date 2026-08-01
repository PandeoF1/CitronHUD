import { useEffect, useRef } from 'react'
import { zestParticlePalette } from '@citronhud/theme'
import type { ZestBurst } from '../state/store'

/**
 * Le champ de zestes — « la ptite emote citron ».
 *
 * Gerbe de particules déclenchée sur les temps forts. Trois partis pris :
 *
 *  - canvas et non DOM : quelques centaines de particules en DOM feraient
 *    chuter la source navigateur pendant précisément le moment qu'on veut
 *    réussir ;
 *  - la boucle d'animation ne tourne QUE tant qu'il reste des particules, puis
 *    s'arrête. Un `requestAnimationFrame` permanent consomme du GPU pendant
 *    les 40 minutes où il ne se passe rien ;
 *  - `prefers-reduced-motion` coupe l'effet — l'overlay finit parfois sur des
 *    écrans de régie où le mouvement gratuit est indésirable.
 */

interface ZestFieldProps {
  bursts: ZestBurst[]
  intensity: 'subtle' | 'normal' | 'heavy'
  enabled: boolean
}

interface Particle {
  x: number
  y: number
  vx: number
  vy: number
  life: number
  maxLife: number
  size: number
  spin: number
  angle: number
  color: string
}

const COUNT_BY_INTENSITY = { subtle: 26, normal: 60, heavy: 120 } as const
const GRAVITY = 780
const DRAG = 0.86

/** Un zeste : quartier allongé, pointu aux deux bouts. */
function drawZest(
  ctx: CanvasRenderingContext2D,
  particle: Particle,
  alpha: number
): void {
  ctx.save()
  ctx.translate(particle.x, particle.y)
  ctx.rotate(particle.angle)
  ctx.globalAlpha = alpha
  ctx.fillStyle = particle.color
  ctx.beginPath()
  ctx.moveTo(-particle.size, 0)
  ctx.quadraticCurveTo(0, -particle.size * 0.52, particle.size, 0)
  ctx.quadraticCurveTo(0, particle.size * 0.52, -particle.size, 0)
  ctx.fill()
  ctx.restore()
}

export function ZestField({ bursts, intensity, enabled }: ZestFieldProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const particlesRef = useRef<Particle[]>([])
  const frameRef = useRef<number | null>(null)
  const lastTimeRef = useRef(0)
  const seenRef = useRef<Set<number>>(new Set())

  // Émission — une seule fois par gerbe, mémorisée par identifiant.
  useEffect(() => {
    if (!enabled) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return

    const canvas = canvasRef.current
    if (!canvas) return

    for (const burst of bursts) {
      if (seenRef.current.has(burst.id)) continue
      seenRef.current.add(burst.id)

      const count = Math.round(COUNT_BY_INTENSITY[intensity] * burst.intensity)
      const originX =
        burst.origin === 'left' ? 0.16 : burst.origin === 'right' ? 0.84 : 0.5
      const x = originX * canvas.width
      const y = canvas.height * 0.42

      for (let i = 0; i < count; i += 1) {
        // Cône vers le haut : une explosion radiale ferait « feu d'artifice »,
        // alors qu'on veut une projection de matière.
        const angle = -Math.PI / 2 + (Math.random() - 0.5) * 1.9
        const speed = 260 + Math.random() * 520
        const maxLife = 0.9 + Math.random() * 0.8
        particlesRef.current.push({
          x,
          y,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          life: maxLife,
          maxLife,
          size: 4 + Math.random() * 7,
          spin: (Math.random() - 0.5) * 9,
          angle: Math.random() * Math.PI * 2,
          color:
            zestParticlePalette[
              Math.floor(Math.random() * zestParticlePalette.length)
            ]!
        })
      }
    }
  }, [bursts, intensity, enabled])

  // Boucle — démarre à la première particule, s'arrête à la dernière.
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const step = (time: number) => {
      const delta = lastTimeRef.current ? Math.min((time - lastTimeRef.current) / 1000, 0.05) : 0
      lastTimeRef.current = time

      ctx.clearRect(0, 0, canvas.width, canvas.height)

      const particles = particlesRef.current
      for (let i = particles.length - 1; i >= 0; i -= 1) {
        const p = particles[i]!
        p.life -= delta
        if (p.life <= 0) {
          particles.splice(i, 1)
          continue
        }
        p.vy += GRAVITY * delta
        p.vx *= Math.pow(DRAG, delta * 60)
        p.x += p.vx * delta
        p.y += p.vy * delta
        p.angle += p.spin * delta

        // Fondu sur le dernier tiers de vie seulement : une opacité qui décroît
        // dès l'émission donne une gerbe fantomatique.
        const ratio = p.life / p.maxLife
        drawZest(ctx, p, ratio > 0.35 ? 1 : ratio / 0.35)
      }

      if (particles.length > 0) {
        frameRef.current = requestAnimationFrame(step)
      } else {
        frameRef.current = null
        lastTimeRef.current = 0
      }
    }

    if (particlesRef.current.length > 0 && frameRef.current === null) {
      frameRef.current = requestAnimationFrame(step)
    }

    return () => {
      if (frameRef.current !== null) {
        cancelAnimationFrame(frameRef.current)
        frameRef.current = null
      }
    }
  }, [bursts])

  if (!enabled) return null

  return <canvas ref={canvasRef} className="zest-field" width={1920} height={1080} />
}
