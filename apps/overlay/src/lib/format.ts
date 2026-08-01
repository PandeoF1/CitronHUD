import type { HudPlayer, ResolvedTeam } from '@citronhud/contracts'
import { healthColor } from '@citronhud/theme'

/** Formatage — regroupé ici pour que les composants ne fassent que du rendu. */

/** Secondes → « 1:47 ». Le chrono ne doit jamais changer de largeur. */
export function clock(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return '--:--'
  const clamped = Math.max(0, Math.floor(seconds))
  const minutes = Math.floor(clamped / 60)
  const rest = clamped % 60
  return `${minutes}:${String(rest).padStart(2, '0')}`
}

/** Compte à rebours de bombe, à la dixième près : chaque dixième compte. */
export function bombClock(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return '--.-'
  return Math.max(0, seconds).toFixed(1)
}

/** Argent : « $3 250 », avec une espace fine insécable à la française. */
export function money(value: number): string {
  return `$${value.toLocaleString('fr-FR').replace(/ | /g, ' ')}`
}

/** Initiales de repli quand un joueur n'a pas de photo. */
export function initials(name: string): string {
  const clean = name.trim()
  if (!clean) return '?'
  const parts = clean.split(/[\s_.-]+/).filter(Boolean)
  if (parts.length >= 2) return (parts[0]![0]! + parts[1]![0]!).toUpperCase()
  return clean.slice(0, 2).toUpperCase()
}

export { healthColor }

/**
 * Couleur d'une équipe.
 *
 * La couleur du roster ne s'applique que si l'opérateur l'a demandée. Par
 * défaut on garde les couleurs de camp : le spectateur lit « CT » et « T »
 * avant de lire un nom d'équipe, et changer cette convention désoriente.
 */
export function teamColor(
  team: ResolvedTeam,
  colors: { ct: string; t: string }
): string {
  if (team.color) return team.color
  return team.side === 'CT' ? colors.ct : colors.t
}

/** Trie une liste de joueurs par slot d'observateur, 10 en dernier. */
export function bySlot(a: HudPlayer, b: HudPlayer): number {
  const left = a.observerSlot === 0 ? 10 : a.observerSlot
  const right = b.observerSlot === 0 ? 10 : b.observerSlot
  return left - right
}

/** Couleur d'un utilitaire dans la ligne d'équipement. */
export function grenadeColor(name: string): string {
  switch (name) {
    case 'weapon_flashbang':
      return 'var(--sem-flash)'
    case 'weapon_smokegrenade':
      return 'var(--sem-smoke)'
    case 'weapon_hegrenade':
      return 'var(--sem-leaf)'
    case 'weapon_molotov':
    case 'weapon_incgrenade':
      return 'var(--sem-fire)'
    case 'weapon_decoy':
      return 'var(--ink-rind-dim)'
    default:
      return 'var(--ink-pulp)'
  }
}

/** Libellé de la phase courante, affiché sous le chrono. */
export function phaseLabel(phase: string, bombPlanted: boolean, defuseTooLate: boolean): string {
  if (defuseTooLate) return 'trop tard'
  if (bombPlanted) return 'bombe posée'
  switch (phase) {
    case 'freezetime':
      return 'préparation'
    case 'over':
      return 'fin de manche'
    case 'warmup':
      return 'échauffement'
    case 'intermission':
      return 'mi-temps'
    case 'timeout':
      return 'temps mort'
    case 'gameover':
      return 'match terminé'
    default:
      return 'en jeu'
  }
}
