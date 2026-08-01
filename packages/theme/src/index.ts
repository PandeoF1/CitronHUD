/**
 * @citronhud/theme — design system « Zeste ».
 *
 * Les tokens sont exposés en TS pour les consommateurs qui ne peuvent pas lire
 * de CSS : particules dessinées sur canvas, thème natif des fenêtres Electron,
 * couleurs de séries dans les graphiques de l'admin.
 */
export * from './tokens'
export { tokens as default } from './tokens'

import { brand, semantic, side } from './tokens'

/**
 * Palette des particules de zeste.
 *
 * Trois teintes plutôt qu'une : une gerbe monochrome paraît plate à l'écran,
 * alors qu'un léger étalement du plus chaud au plus clair lit comme de la
 * matière projetée.
 */
export const zestParticlePalette = [brand.rind, brand.zest, '#FFF3B0'] as const

/** Couleur d'un camp, avec repli sur les valeurs par défaut du système. */
export function sideColor(team: 'CT' | 'T', overrides?: { ct?: string; t?: string }): string {
  if (team === 'CT') return overrides?.ct || side.ct
  return overrides?.t || side.t
}

/**
 * Couleur d'une barre de vie.
 *
 * Le crème tient jusqu'à 40 % puis bascule vers l'ambre et le rouge : on ne
 * veut pas d'un dégradé continu, qui rendrait les seuils illisibles d'un coup
 * d'œil pendant une action.
 */
export function healthColor(health: number): string {
  if (health <= 0) return semantic.blood
  if (health <= 20) return semantic.blood
  if (health <= 40) return semantic.warn
  return '#F3EEDC'
}
