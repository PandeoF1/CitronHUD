import type { RawGsiPayload, RawPlayer } from './types'

/**
 * Simulateur de flux GSI.
 *
 * Deux usages, et le second justifie à lui seul son existence :
 *
 *  1. Les tests, qui ont besoin de trames déterministes.
 *  2. Le mode démo du client. Positionner un overlay dans OBS demande de voir
 *     à quoi il ressemble ; sans simulateur, il faudrait lancer CS2 et trouver
 *     un match. Le streamer peut ici caler ses sources avant le jour J.
 */

export interface SimulatedPlayerSpec {
  steamId: string
  name: string
  side: 'CT' | 'T'
  observerSlot: number
  health?: number
  kills?: number
  assists?: number
  deaths?: number
  roundKills?: number
  roundHeadshots?: number
  roundDamage?: number
  money?: number
  activeWeapon?: string
  position?: [number, number, number]
  defuseKit?: boolean
  mvps?: number
}

export interface SimulatedFrameSpec {
  phase?: 'warmup' | 'freezetime' | 'live' | 'over' | 'intermission' | 'gameover'
  phaseEndsIn?: number
  mapName?: string
  round?: number
  ctScore?: number
  tScore?: number
  winTeam?: 'CT' | 'T' | null
  bomb?: {
    state: string
    countdown?: number
    player?: string
  } | null
  observed?: string
  /** Issues des manches déjà jouées, indexées à partir de « 1 ». */
  roundWins?: Record<string, string>
  grenades?: Record<string, import('./types').RawGrenade>
  players: SimulatedPlayerSpec[]
}

function buildPlayer(spec: SimulatedPlayerSpec): RawPlayer {
  const health = spec.health ?? 100
  const weapons: Record<string, import('./types').RawWeapon> = {
    weapon_0: {
      name: 'weapon_knife',
      type: 'Knife',
      state: spec.activeWeapon ? 'holstered' : 'active'
    }
  }

  if (spec.activeWeapon) {
    weapons.weapon_1 = {
      name: spec.activeWeapon,
      type: spec.activeWeapon.includes('deagle') ? 'Pistol' : 'Rifle',
      state: 'active',
      ammo_clip: 24,
      ammo_clip_max: 30,
      ammo_reserve: 90
    }
  }

  return {
    name: spec.name,
    // Le GSI transmet 0-9 ; la normalisation ramène en 1-10 côté moteur.
    observer_slot: spec.observerSlot - 1,
    team: spec.side,
    state: {
      health,
      armor: health > 0 ? 100 : 0,
      helmet: true,
      defusekit: spec.defuseKit ?? false,
      flashed: 0,
      burning: 0,
      money: spec.money ?? 3500,
      round_kills: spec.roundKills ?? 0,
      round_killhs: spec.roundHeadshots ?? 0,
      round_totaldmg: spec.roundDamage ?? 0,
      equip_value: 4200
    },
    match_stats: {
      kills: spec.kills ?? 0,
      assists: spec.assists ?? 0,
      deaths: spec.deaths ?? 0,
      mvps: spec.mvps ?? 0,
      score: (spec.kills ?? 0) * 2
    },
    weapons,
    position: (spec.position ?? [0, 0, 0]).join(', '),
    forward: '1.00, 0.00, 0.00'
  }
}

/** Construit une trame GSI brute complète depuis une description compacte. */
export function buildFrame(spec: SimulatedFrameSpec): RawGsiPayload {
  const allplayers: Record<string, RawPlayer> = {}
  for (const player of spec.players) {
    allplayers[player.steamId] = buildPlayer(player)
  }

  const phase = spec.phase ?? 'live'
  const observed = spec.observed ?? spec.players[0]?.steamId

  const payload: RawGsiPayload = {
    provider: { name: 'Counter-Strike: Global Offensive', appid: 730, timestamp: Date.now() },
    map: {
      mode: 'competitive',
      name: spec.mapName ?? 'de_mirage',
      phase: phase === 'warmup' ? 'warmup' : phase === 'gameover' ? 'gameover' : 'live',
      round: spec.round ?? 0,
      team_ct: { score: spec.ctScore ?? 0, consecutive_round_losses: 0, timeouts_remaining: 4 },
      team_t: { score: spec.tScore ?? 0, consecutive_round_losses: 0, timeouts_remaining: 4 },
      num_matches_to_win_series: 1,
      round_wins: spec.roundWins ?? {}
    },
    round: {
      phase: phase === 'freezetime' ? 'freezetime' : phase === 'over' ? 'over' : 'live',
      win_team: spec.winTeam ?? undefined
    },
    phase_countdowns: {
      phase,
      phase_ends_in: String(spec.phaseEndsIn ?? 95)
    },
    allplayers
  }

  if (spec.grenades) payload.grenades = spec.grenades

  if (observed) {
    payload.player = { steamid: observed, spectarget: observed, observer_slot: 0 }
  }

  if (spec.bomb) {
    payload.bomb = {
      state: spec.bomb.state,
      countdown: spec.bomb.countdown !== undefined ? String(spec.bomb.countdown) : undefined,
      player: spec.bomb.player,
      position: '100.0, 200.0, 30.0'
    }
  }

  return payload
}

/** Dix joueurs plausibles, pour le mode démo et les tests. */
export function demoPlayers(): SimulatedPlayerSpec[] {
  const names = [
    'zeste',
    'pressé',
    'acide',
    'pépin',
    'écorce',
    'sucré',
    'amer',
    'jus',
    'quartier',
    'confit'
  ]

  return names.map((name, index) => ({
    steamId: `7656119${String(1000000000 + index).padStart(10, '0')}`,
    name,
    side: index < 5 ? ('CT' as const) : ('T' as const),
    observerSlot: index + 1,
    health: 100,
    kills: 10 - index,
    deaths: index + 2,
    assists: index % 4,
    money: 4500 - index * 200,
    activeWeapon: index % 3 === 0 ? 'weapon_awp' : 'weapon_ak47',
    position: [index * 200 - 1000, index * 150 - 700, 0] as [number, number, number]
  }))
}

/**
 * Générateur de match de démonstration.
 *
 * Fait vivre un match plausible : les manches avancent, les scores montent, des
 * joueurs meurent et reviennent. Assez pour juger de la lisibilité du HUD dans
 * OBS sans ouvrir le jeu.
 */
export class DemoMatch {
  private round = 0
  private ctScore = 0
  private tScore = 0
  private tick = 0
  private players = demoPlayers()

  next(): RawGsiPayload {
    this.tick++

    // Une manche dure environ 60 trames de démo, soit ~6 secondes à 10 Hz.
    const inRound = this.tick % 60
    const phase = inRound < 8 ? 'freezetime' : inRound < 54 ? 'live' : 'over'

    if (inRound === 0 && this.tick > 0) {
      const ctWins = Math.random() > 0.5
      if (ctWins) this.ctScore++
      else this.tScore++
      this.round++
      this.players = demoPlayers()
    }

    if (phase === 'live' && Math.random() < 0.06) {
      const victim = this.players[Math.floor(Math.random() * this.players.length)]
      if (victim && victim.health !== 0) {
        victim.health = 0
        victim.deaths = (victim.deaths ?? 0) + 1
        const killers = this.players.filter((p) => p.side !== victim.side && p.health !== 0)
        const killer = killers[Math.floor(Math.random() * killers.length)]
        if (killer) {
          killer.kills = (killer.kills ?? 0) + 1
          killer.roundKills = (killer.roundKills ?? 0) + 1
          killer.roundDamage = (killer.roundDamage ?? 0) + 100
        }
      }
    }

    const alive = this.players.filter((p) => p.health !== 0)
    const observed = alive[this.tick % Math.max(1, alive.length)]?.steamId

    return buildFrame({
      phase,
      phaseEndsIn: phase === 'live' ? 115 - inRound * 2 : 15,
      round: this.round,
      ctScore: this.ctScore,
      tScore: this.tScore,
      players: this.players,
      observed,
      bomb:
        inRound > 30 && inRound < 54 ? { state: 'planted', countdown: 40 - (inRound - 30) } : null
    })
  }
}
