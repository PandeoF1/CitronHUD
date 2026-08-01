import { z } from 'zod'
import { idSchema, isoDateSchema, steamId64Schema } from './common'

/**
 * Records — les meilleures performances, conservées entre les matchs.
 *
 * C'est ce qui transforme des statistiques jetables en récit : « 34 kills, le
 * record de la saison » vaut mieux que « 34 kills ». Le HUD affiche un bandeau
 * quand un record tombe en direct.
 */

export const recordMetricSchema = z.enum([
  'kills_match',
  'kills_round',
  'adr_match',
  'headshot_percent_match',
  'aces_total',
  'clutches_won_total',
  'multikills_total',
  'rounds_won_streak',
  'damage_round',
  'fastest_defuse_ms',
  'mvps_match'
])
export type RecordMetric = z.infer<typeof recordMetricSchema>

/**
 * Sens de comparaison de chaque métrique.
 *
 * Un désamorçage rapide est un record quand la valeur BAISSE ; tout le reste
 * quand elle monte. Sans cette table, la comparaison serait dupliquée dans
 * chaque appelant et finirait par diverger.
 */
export const RECORD_DIRECTION: Record<RecordMetric, 'higher' | 'lower'> = {
  kills_match: 'higher',
  kills_round: 'higher',
  adr_match: 'higher',
  headshot_percent_match: 'higher',
  aces_total: 'higher',
  clutches_won_total: 'higher',
  multikills_total: 'higher',
  rounds_won_streak: 'higher',
  damage_round: 'higher',
  fastest_defuse_ms: 'lower',
  mvps_match: 'higher'
}

export const RECORD_LABEL: Record<RecordMetric, string> = {
  kills_match: 'Kills sur un match',
  kills_round: 'Kills sur une manche',
  adr_match: 'ADR sur un match',
  headshot_percent_match: '% headshot sur un match',
  aces_total: 'Aces cumulés',
  clutches_won_total: 'Clutchs gagnés',
  multikills_total: 'Multikills cumulés',
  rounds_won_streak: 'Série de manches gagnées',
  damage_round: 'Dégâts sur une manche',
  fastest_defuse_ms: 'Désamorçage le plus rapide',
  mvps_match: 'MVP sur un match'
}

/** Unité d'affichage, pour formater sans table de correspondance ailleurs. */
export const RECORD_UNIT: Record<RecordMetric, 'count' | 'percent' | 'milliseconds' | 'decimal'> = {
  kills_match: 'count',
  kills_round: 'count',
  adr_match: 'decimal',
  headshot_percent_match: 'percent',
  aces_total: 'count',
  clutches_won_total: 'count',
  multikills_total: 'count',
  rounds_won_streak: 'count',
  damage_round: 'count',
  fastest_defuse_ms: 'milliseconds',
  mvps_match: 'count'
}

/**
 * Portée d'un record.
 *
 * `player` suit un joueur donné, `team` une équipe, `global` le meilleur toutes
 * équipes confondues. Les trois coexistent : battre son propre record et battre
 * le record global sont deux moments différents à l'antenne.
 */
export const recordScopeSchema = z.enum(['player', 'team', 'global'])
export type RecordScope = z.infer<typeof recordScopeSchema>

export const recordSchema = z.object({
  id: idSchema,
  scope: recordScopeSchema,
  metric: recordMetricSchema,
  /** Renseigné pour les portées `player` et `global`. */
  steamId: steamId64Schema.nullable(),
  playerName: z.string().nullable(),
  playerAvatarUrl: z.string().nullable(),
  teamId: idSchema.nullable(),
  teamName: z.string().nullable(),

  value: z.number(),
  mapName: z.string().nullable(),
  matchId: idSchema.nullable(),
  sessionId: idSchema.nullable(),
  achievedAt: isoDateSchema,
  /** Valeur détrônée, pour afficher « 32 → 34 » sur le bandeau. */
  previousValue: z.number().nullable()
})
export type GameRecord = z.infer<typeof recordSchema>

export const createRecordSchema = recordSchema.omit({ id: true })
export type CreateRecord = z.infer<typeof createRecordSchema>

/** Évènement poussé vers l'overlay quand un record tombe en direct. */
export const recordBrokenSchema = z.object({
  metric: recordMetricSchema,
  scope: recordScopeSchema,
  label: z.string(),
  steamId: z.string().nullable(),
  playerName: z.string().nullable(),
  playerAvatarUrl: z.string().nullable(),
  value: z.number(),
  previousValue: z.number().nullable(),
  unit: z.enum(['count', 'percent', 'milliseconds', 'decimal'])
})
export type RecordBroken = z.infer<typeof recordBrokenSchema>

/**
 * Compare une valeur au record en place.
 *
 * Renvoie `true` uniquement en cas de dépassement strict : égaler un record
 * n'est pas le battre, et déclencher le bandeau à chaque égalité le banaliserait.
 */
export function beatsRecord(metric: RecordMetric, candidate: number, current: number | null) {
  if (current === null) return true
  return RECORD_DIRECTION[metric] === 'higher' ? candidate > current : candidate < current
}

/** Met en forme une valeur de record pour l'affichage. */
export function formatRecordValue(metric: RecordMetric, value: number): string {
  switch (RECORD_UNIT[metric]) {
    case 'percent':
      return `${Math.round(value)} %`
    case 'decimal':
      return value.toFixed(1)
    case 'milliseconds':
      return `${(value / 1000).toFixed(2)} s`
    default:
      return String(Math.round(value))
  }
}
