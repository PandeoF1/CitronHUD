import type { RecordBroken, RecordMetric, RecordScope } from '@citronhud/contracts'
import { RECORD_LABEL, RECORD_UNIT, beatsRecord } from '@citronhud/contracts'
import type { NormalizedFrame } from './types'
import type { MatchStatsTracker } from './stats'

/**
 * Suivi des records en direct.
 *
 * Transforme des statistiques jetables en récit : « 34 kills » devient « 34
 * kills, record de la saison ». Le bandeau ne se déclenche qu'au dépassement
 * strict et une seule fois par joueur et par métrique sur un match — sinon un
 * joueur en forme ferait clignoter le HUD à chaque kill.
 */

export interface KnownRecord {
  scope: RecordScope
  metric: RecordMetric
  /** SteamID pour la portée `player`, identifiant d'équipe pour `team`. */
  holderKey: string | null
  value: number
}

/** Seuils sous lesquels une métrique n'a pas encore de sens statistique. */
const MIN_ROUNDS: Partial<Record<RecordMetric, number>> = {
  adr_match: 6,
  headshot_percent_match: 6
}

/** Valeurs planchers : un « record » ridicule n'a pas à passer à l'antenne. */
const MIN_VALUE: Partial<Record<RecordMetric, number>> = {
  kills_match: 15,
  kills_round: 3,
  adr_match: 70,
  headshot_percent_match: 50,
  damage_round: 200,
  mvps_match: 3
}

function keyOf(scope: RecordScope, metric: RecordMetric, holderKey: string | null): string {
  return `${scope}:${metric}:${holderKey ?? 'global'}`
}

export class RecordTracker {
  /** Records connus, chargés depuis le serveur ou le cache local. */
  private readonly known = new Map<string, number>()
  /** Ce qui a déjà été annoncé sur ce match. */
  private readonly announced = new Set<string>()
  /** Meilleures valeurs atteintes pendant la session, à synchroniser plus tard. */
  private readonly session = new Map<
    string,
    { metric: RecordMetric; steamId: string; value: number }
  >()

  private currentMap: string | null = null

  /** Charge les records de référence. À rappeler après chaque synchronisation. */
  load(records: readonly KnownRecord[]): void {
    this.known.clear()
    for (const record of records) {
      this.known.set(keyOf(record.scope, record.metric, record.holderKey), record.value)
    }
  }

  /** Meilleures performances de la session, prêtes à être envoyées au serveur. */
  get sessionBests(): Array<{ metric: RecordMetric; steamId: string; value: number }> {
    return [...this.session.values()]
  }

  reset(): void {
    this.announced.clear()
    this.session.clear()
    this.currentMap = null
  }

  ingest(
    frame: NormalizedFrame,
    stats: MatchStatsTracker,
    resolveName: (steamId: string) => { name: string; avatarUrl: string | null }
  ): RecordBroken[] {
    const map = frame.map
    if (!map) return []

    // Échauffement : les compteurs ne veulent rien dire.
    if (frame.phase === 'warmup' || frame.phase === 'unknown') return []

    if (map.name !== this.currentMap) {
      this.currentMap = map.name
      this.announced.clear()
    }

    const rounds = stats.roundsCounted
    const broken: RecordBroken[] = []

    for (const player of frame.players) {
      const derived = stats.derive(player.steamId, player.kills, player.deaths)

      const candidates: Array<{ metric: RecordMetric; value: number }> = [
        { metric: 'kills_match', value: player.kills },
        { metric: 'kills_round', value: player.roundKills },
        { metric: 'damage_round', value: player.roundDamage },
        { metric: 'mvps_match', value: player.mvps },
        { metric: 'adr_match', value: derived.adr },
        { metric: 'headshot_percent_match', value: derived.headshotPercent }
      ]

      for (const candidate of candidates) {
        const minRounds = MIN_ROUNDS[candidate.metric]
        if (minRounds !== undefined && rounds < minRounds) continue

        const floor = MIN_VALUE[candidate.metric]
        if (floor !== undefined && candidate.value < floor) continue

        this.trackSessionBest(candidate.metric, player.steamId, candidate.value)

        const key = keyOf('player', candidate.metric, player.steamId)
        const current = this.known.get(key) ?? null

        if (!beatsRecord(candidate.metric, candidate.value, current)) continue
        if (this.announced.has(key)) {
          // Déjà annoncé : on met à jour la référence sans repasser à l'antenne.
          this.known.set(key, candidate.value)
          continue
        }

        this.announced.add(key)
        this.known.set(key, candidate.value)

        const identity = resolveName(player.steamId)
        broken.push({
          metric: candidate.metric,
          scope: 'player',
          label: RECORD_LABEL[candidate.metric],
          steamId: player.steamId,
          playerName: identity.name,
          playerAvatarUrl: identity.avatarUrl,
          value: candidate.value,
          previousValue: current,
          unit: RECORD_UNIT[candidate.metric]
        })
      }
    }

    return broken
  }

  private trackSessionBest(metric: RecordMetric, steamId: string, value: number): void {
    const key = `${metric}:${steamId}`
    const existing = this.session.get(key)
    if (!existing || beatsRecord(metric, value, existing.value)) {
      this.session.set(key, { metric, steamId, value })
    }
  }
}
