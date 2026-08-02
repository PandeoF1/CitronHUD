import type { HudGrenade } from '@citronhud/contracts'
import type { NormalizedFrame, NormalizedGrenade, Vec3 } from './types'

/**
 * Suivi des utilitaires en vol et de leurs effets au sol.
 *
 * Le GSI décrit chaque projectile trame par trame, sans mémoire : une grenade
 * apparaît, se déplace, disparaît. Une position isolée ne dit rien à l'écran —
 * ce que le spectateur lit, c'est la *trajectoire* : d'où part le smoke, par
 * dessus quoi il passe. On accumule donc les positions successives pour dessiner
 * la traînée, ce que le flux ne fournit pas.
 */

/**
 * Nombre de points conservés par traînée.
 *
 * À 20 trames par seconde, 40 points couvrent deux secondes de vol — assez pour
 * la parabole complète d'un lancer long, sans faire traîner un fantôme derrière
 * un projectile déjà retombé.
 */
const TRAIL_LENGTH = 40

/**
 * Rayons d'effet, en unités monde.
 *
 * Le fumigène de CS2 fait 144 unités de rayon au sol. Les foyers incendiaires
 * sont donnés un par un par le jeu : on les dessine individuellement plutôt que
 * d'inventer une enveloppe, et leur chevauchement redessine la nappe telle
 * qu'elle est réellement, y compris quand elle coule le long d'une pente.
 */
const SMOKE_RADIUS = 144
const FLAME_RADIUS = 90

/** Un projectile est considéré posé quand il ne bouge quasiment plus. */
const RESTING_SPEED = 12

function speed(velocity: Vec3 | null): number {
  if (!velocity) return 0
  return Math.hypot(velocity[0], velocity[1], velocity[2])
}

export class GrenadeTracker {
  private trails = new Map<string, Vec3[]>()
  private round = -1

  reset(): void {
    this.trails.clear()
    this.round = -1
  }

  /**
   * Produit les utilitaires prêts à dessiner pour cette trame.
   *
   * Les traînées sont purgées au changement de manche : CS2 recycle les
   * identifiants de projectiles, et une traînée héritée relierait deux lancers
   * sans rapport à travers la carte.
   */
  ingest(frame: NormalizedFrame, sideOf: (steamId: string) => 'CT' | 'T' | null): HudGrenade[] {
    const round = frame.map?.round ?? -1
    if (round !== this.round) {
      this.trails.clear()
      this.round = round
    }

    const seen = new Set<string>()
    const result: HudGrenade[] = []

    for (const grenade of frame.grenades) {
      seen.add(grenade.id)
      result.push(this.resolve(grenade, sideOf))
    }

    for (const id of this.trails.keys()) {
      if (!seen.has(id)) this.trails.delete(id)
    }

    return result
  }

  private resolve(
    grenade: NormalizedGrenade,
    sideOf: (steamId: string) => 'CT' | 'T' | null
  ): HudGrenade {
    const moving = speed(grenade.velocity) > RESTING_SPEED

    let trail = this.trails.get(grenade.id)
    if (grenade.position && moving) {
      trail ??= []
      const last = trail[trail.length - 1]
      // On ignore les répétitions : sous le seuil de mouvement le jeu renvoie
      // la même position et la traînée se remplirait de doublons.
      if (!last || last[0] !== grenade.position[0] || last[1] !== grenade.position[1]) {
        trail.push(grenade.position)
        if (trail.length > TRAIL_LENGTH) trail.shift()
      }
      this.trails.set(grenade.id, trail)
    }

    const active =
      grenade.type === 'smoke'
        ? grenade.effectTime > 0
        : grenade.type === 'incendiary'
          ? grenade.flames.length > 0
          : false

    return {
      id: grenade.id,
      type: grenade.type,
      ownerSteamId: grenade.ownerSteamId,
      side: grenade.ownerSteamId ? sideOf(grenade.ownerSteamId) : null,
      position: grenade.position,
      active,
      radius: grenade.type === 'smoke' && active ? SMOKE_RADIUS : 0,
      flameRadius: FLAME_RADIUS,
      flames: grenade.flames,
      trail: trail ? [...trail] : []
    }
  }
}
