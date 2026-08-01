import type {
  NormalizedFrame,
  NormalizedPlayer,
  NormalizedWeapon,
  RawGsiPayload,
  RawPlayer,
  RoundPhase,
  Vec3
} from './types'
import { mapKey, mapLabel } from './maps'
import { weaponLabel } from './weapons'

/**
 * Normalisation d'une trame GSI brute.
 *
 * Point d'entrée unique : plus rien en aval ne touche au payload brut. Toutes
 * les tolérances aux champs manquants sont concentrées ici, ce qui évite de
 * semer des `?.` défensifs dans la logique métier.
 */

/** « 1234.50, -678.90, 12.30 » → [1234.5, -678.9, 12.3]. */
function parseVec3(raw: string | undefined | null): Vec3 | null {
  if (!raw) return null
  const parts = raw.split(',')
  if (parts.length !== 3) return null
  const x = Number.parseFloat(parts[0]!)
  const y = Number.parseFloat(parts[1]!)
  const z = Number.parseFloat(parts[2]!)
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return null
  return [x, y, z]
}

function parseFloatOrNull(raw: string | number | undefined | null): number | null {
  if (raw === undefined || raw === null) return null
  const value = typeof raw === 'number' ? raw : Number.parseFloat(raw)
  return Number.isFinite(value) ? value : null
}

/**
 * Phase effective de la manche.
 *
 * Trois sources se contredisent parfois. `phase_countdowns` est la plus précise
 * (elle distingue les temps morts et le désamorçage), on la privilégie et on
 * retombe sur les autres quand elle manque.
 */
function resolvePhase(payload: RawGsiPayload): RoundPhase {
  const countdown = payload.phase_countdowns?.phase
  switch (countdown) {
    case 'freezetime':
      return 'freezetime'
    case 'live':
    case 'bomb':
    case 'defusing':
      return 'live'
    case 'over':
      return 'over'
    case 'warmup':
      return 'warmup'
    case 'paused':
    case 'timeout_ct':
    case 'timeout_t':
      return 'timeout'
    default:
      break
  }

  const round = payload.round?.phase
  if (round === 'freezetime') return 'freezetime'
  if (round === 'live') return 'live'
  if (round === 'over') return 'over'

  const map = payload.map?.phase
  if (map === 'warmup') return 'warmup'
  if (map === 'intermission') return 'intermission'
  if (map === 'gameover') return 'gameover'
  if (map === 'live') return 'live'

  return 'unknown'
}

function normalizeWeapons(raw: Record<string, import('./types').RawWeapon> | undefined): {
  weapons: NormalizedWeapon[]
  active: NormalizedWeapon | null
} {
  if (!raw) return { weapons: [], active: null }

  const weapons: NormalizedWeapon[] = []
  let active: NormalizedWeapon | null = null

  for (const entry of Object.values(raw)) {
    if (!entry?.name) continue
    const state =
      entry.state === 'active' ? 'active' : entry.state === 'reloading' ? 'reloading' : 'holstered'
    const weapon: NormalizedWeapon = {
      name: entry.name,
      label: weaponLabel(entry.name),
      type: entry.type ?? null,
      state,
      ammoClip: entry.ammo_clip ?? null,
      ammoClipMax: entry.ammo_clip_max ?? null,
      ammoReserve: entry.ammo_reserve ?? null
    }
    weapons.push(weapon)
    // `reloading` compte comme arme en main : c'est bien celle qui tire.
    if (state === 'active' || state === 'reloading') active = weapon
  }

  return { weapons, active }
}

function normalizePlayer(steamId: string, raw: RawPlayer): NormalizedPlayer | null {
  const team = raw.team
  if (team !== 'CT' && team !== 'T') return null

  const state = raw.state ?? {}
  const stats = raw.match_stats ?? {}
  const { weapons, active } = normalizeWeapons(raw.weapons)
  const health = state.health ?? 0

  /*
   * CS2 numérote les slots d'observateur de 0 à 9, alors que les binds et les
   * habitudes des observateurs vont de 1 à 10 (la touche 0 valant le slot 10).
   * On aligne ici pour que le HUD affiche ce que l'observateur tape.
   */
  const rawSlot = raw.observer_slot
  const observerSlot = typeof rawSlot === 'number' ? (rawSlot + 1 === 10 ? 0 : rawSlot + 1) : 0

  return {
    steamId,
    name: raw.name ?? 'Inconnu',
    clan: raw.clan ?? null,
    observerSlot,
    side: team,
    health,
    armor: state.armor ?? 0,
    helmet: state.helmet ?? false,
    defuseKit: state.defusekit ?? false,
    flashed: state.flashed ?? 0,
    burning: state.burning ?? 0,
    money: state.money ?? 0,
    equipmentValue: state.equip_value ?? 0,
    roundKills: state.round_kills ?? 0,
    roundHeadshots: state.round_killhs ?? 0,
    roundDamage: state.round_totaldmg ?? 0,
    kills: stats.kills ?? 0,
    assists: stats.assists ?? 0,
    deaths: stats.deaths ?? 0,
    mvps: stats.mvps ?? 0,
    score: stats.score ?? 0,
    weapons,
    activeWeapon: active,
    position: parseVec3(raw.position),
    forward: parseVec3(raw.forward),
    alive: health > 0
  }
}

export function normalizeFrame(payload: RawGsiPayload, receivedAt = Date.now()): NormalizedFrame {
  const phase = resolvePhase(payload)

  const players: NormalizedPlayer[] = []
  const playersBySteamId = new Map<string, NormalizedPlayer>()

  if (payload.allplayers) {
    for (const [steamId, raw] of Object.entries(payload.allplayers)) {
      const player = normalizePlayer(steamId, raw)
      if (!player) continue
      players.push(player)
      playersBySteamId.set(steamId, player)
    }
  }

  // Slots croissants, avec le slot 10 (affiché « 0 ») rejeté en fin de liste.
  players.sort((a, b) => {
    const left = a.observerSlot === 0 ? 10 : a.observerSlot
    const right = b.observerSlot === 0 ? 10 : b.observerSlot
    return left - right
  })

  const rawMap = payload.map
  const map = rawMap?.name
    ? {
        name: mapKey(rawMap.name),
        label: mapLabel(rawMap.name),
        mode: rawMap.mode ?? 'competitive',
        round: rawMap.round ?? 0,
        ctScore: rawMap.team_ct?.score ?? 0,
        tScore: rawMap.team_t?.score ?? 0,
        ctLossBonus: rawMap.team_ct?.consecutive_round_losses ?? 0,
        tLossBonus: rawMap.team_t?.consecutive_round_losses ?? 0,
        ctTimeouts: rawMap.team_ct?.timeouts_remaining ?? 0,
        tTimeouts: rawMap.team_t?.timeouts_remaining ?? 0,
        ctSeriesWins: rawMap.team_ct?.matches_won_this_series ?? 0,
        tSeriesWins: rawMap.team_t?.matches_won_this_series ?? 0,
        roundWins: rawMap.round_wins ?? {},
        seriesTarget: rawMap.num_matches_to_win_series ?? 1
      }
    : null

  const rawRound = payload.round
  const round = rawRound
    ? {
        phase,
        winTeam: rawRound.win_team === 'CT' ? 'CT' : rawRound.win_team === 'T' ? 'T' : null,
        bomb: rawRound.bomb ?? null
      }
    : null

  const rawBomb = payload.bomb
  const bomb = rawBomb?.state
    ? {
        state: rawBomb.state,
        countdown: parseFloatOrNull(rawBomb.countdown),
        playerSteamId: rawBomb.player ?? null,
        position: parseVec3(rawBomb.position)
      }
    : null

  /*
   * `player` désigne le joueur suivi par la caméra. En spectateur son
   * `spectarget` pointe vers la cible réelle ; en jeu, c'est le joueur lui-même.
   */
  const observedSteamId = payload.player?.spectarget ?? payload.player?.steamid ?? null

  return {
    receivedAt,
    phase,
    phaseEndsIn: parseFloatOrNull(payload.phase_countdowns?.phase_ends_in),
    map,
    round: round as NormalizedFrame['round'],
    bomb,
    players,
    playersBySteamId,
    observedSteamId:
      observedSteamId && playersBySteamId.has(observedSteamId) ? observedSteamId : null
  }
}

/** Compte les joueurs en vie de chaque camp. */
export function aliveCounts(frame: NormalizedFrame): { CT: number; T: number } {
  let ct = 0
  let t = 0
  for (const player of frame.players) {
    if (!player.alive) continue
    if (player.side === 'CT') ct++
    else t++
  }
  return { CT: ct, T: t }
}
