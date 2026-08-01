/**
 * Forme brute des trames Game State Integration de CS2.
 *
 * Typée à la main plutôt qu'importée d'une bibliothèque : le moteur doit
 * tolérer les trames partielles. CS2 omet des blocs entiers selon le contexte
 * (`allplayers` n'existe qu'en spectateur, `bomb` disparaît hors manche), et un
 * type trop strict conduirait à des accès `undefined` en pleine diffusion.
 * Tout est donc optionnel, et la normalisation comble les trous.
 */

export interface RawProvider {
  name?: string
  appid?: number
  version?: number
  steamid?: string
  timestamp?: number
}

export interface RawTeamState {
  score?: number
  name?: string
  flag?: string
  consecutive_round_losses?: number
  timeouts_remaining?: number
  matches_won_this_series?: number
}

export interface RawMap {
  mode?: string
  name?: string
  phase?: string
  round?: number
  team_ct?: RawTeamState
  team_t?: RawTeamState
  num_matches_to_win_series?: number
  current_spectators?: number
  souvenirs_total?: number
  /** Résultat de chaque manche, indexé par numéro : « 1 » → « ct_win_elimination ». */
  round_wins?: Record<string, string>
}

export interface RawRound {
  phase?: string
  win_team?: string
  bomb?: string
}

export interface RawPlayerState {
  health?: number
  armor?: number
  helmet?: boolean
  defusekit?: boolean
  flashed?: number
  smoked?: number
  burning?: number
  money?: number
  round_kills?: number
  round_killhs?: number
  round_totaldmg?: number
  equip_value?: number
}

export interface RawMatchStats {
  kills?: number
  assists?: number
  deaths?: number
  mvps?: number
  score?: number
}

export interface RawWeapon {
  name?: string
  paintkit?: string
  type?: string
  state?: string
  ammo_clip?: number
  ammo_clip_max?: number
  ammo_reserve?: number
}

export interface RawPlayer {
  steamid?: string
  name?: string
  clan?: string
  observer_slot?: number
  team?: string
  activity?: string
  state?: RawPlayerState
  match_stats?: RawMatchStats
  weapons?: Record<string, RawWeapon>
  position?: string
  forward?: string
  spectarget?: string
}

export interface RawBomb {
  state?: string
  position?: string
  player?: string
  countdown?: string
}

export interface RawPhaseCountdowns {
  phase?: string
  phase_ends_in?: string
}

export interface RawGsiPayload {
  provider?: RawProvider
  map?: RawMap
  round?: RawRound
  player?: RawPlayer
  allplayers?: Record<string, RawPlayer>
  bomb?: RawBomb
  phase_countdowns?: RawPhaseCountdowns
  grenades?: Record<string, unknown>
  auth?: Record<string, string>
  previously?: unknown
  added?: unknown
}

/* -------------------------------------------------------------------------
 * Trame normalisée
 *
 * Représentation interne au moteur : champs garantis, types resserrés,
 * positions déjà parsées. Tout le reste du moteur ne travaille que là-dessus.
 * ---------------------------------------------------------------------- */

export type Vec3 = [number, number, number]

export interface NormalizedWeapon {
  name: string
  label: string
  type: string | null
  state: 'active' | 'holstered' | 'reloading'
  ammoClip: number | null
  ammoClipMax: number | null
  ammoReserve: number | null
}

export interface NormalizedPlayer {
  steamId: string
  name: string
  clan: string | null
  observerSlot: number
  side: 'CT' | 'T'
  health: number
  armor: number
  helmet: boolean
  defuseKit: boolean
  flashed: number
  burning: number
  money: number
  equipmentValue: number
  roundKills: number
  roundHeadshots: number
  roundDamage: number
  kills: number
  assists: number
  deaths: number
  mvps: number
  score: number
  weapons: NormalizedWeapon[]
  activeWeapon: NormalizedWeapon | null
  position: Vec3 | null
  forward: Vec3 | null
  alive: boolean
}

export type RoundPhase =
  | 'warmup'
  | 'freezetime'
  | 'live'
  | 'over'
  | 'intermission'
  | 'timeout'
  | 'gameover'
  | 'unknown'

export interface NormalizedFrame {
  /** Millisecondes epoch de réception, pas l'horodatage du fournisseur. */
  receivedAt: number
  phase: RoundPhase
  phaseEndsIn: number | null
  map: {
    name: string
    label: string
    mode: string
    round: number
    ctScore: number
    tScore: number
    ctLossBonus: number
    tLossBonus: number
    ctTimeouts: number
    tTimeouts: number
    ctSeriesWins: number
    tSeriesWins: number
    roundWins: Record<string, string>
    seriesTarget: number
  } | null
  round: {
    phase: RoundPhase
    winTeam: 'CT' | 'T' | null
    bomb: string | null
  } | null
  bomb: {
    state: string
    countdown: number | null
    playerSteamId: string | null
    position: Vec3 | null
  } | null
  players: NormalizedPlayer[]
  playersBySteamId: Map<string, NormalizedPlayer>
  /** SteamID du joueur actuellement suivi par la caméra spectateur. */
  observedSteamId: string | null
}
