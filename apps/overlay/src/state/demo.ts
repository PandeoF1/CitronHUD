import type { HudPlayer, HudState, ResolvedTeam, Side } from '@citronhud/contracts'
import { useOverlay } from './store'

/**
 * Scène de démonstration — `?demo=1`.
 *
 * Sert à travailler l'apparence sans CS2 : mise en page, débordements de noms,
 * lisibilité des seuils de vie. Les valeurs sont choisies pour exercer les cas
 * pénibles plutôt que le cas moyen — pseudo très long, joueur à 3 PV, joueur
 * inconnu du roster, score serré, bombe posée.
 *
 * Ce module ne sert QUE la démo : il n'est jamais importé par le chemin normal.
 */

const CT_NAMES = ['ZESTE', 'kiwiii', 'Ap0llo', 'marmelade-du-93', 'nx']
const T_NAMES = ['Sh1ro', 'bl4ck', 'Toto', 'PRESSÉ', 'yuki']

function makePlayer(
  name: string,
  index: number,
  side: Side,
  slotOffset: number,
  overrides: Partial<HudPlayer> = {}
): HudPlayer {
  const health = overrides.health ?? [100, 78, 3, 100, 45][index % 5]!
  return {
    steamId: `7656119${(8000000000 + slotOffset * 10 + index).toString()}`,
    name,
    realName: null,
    country: ['FR', 'FR', 'BE', 'FR', 'CH'][index % 5]!,
    avatarUrl: null,
    role: null,
    known: index !== 3,
    slot: side === 'CT' ? 'left' : 'right',
    side,
    observerSlot: slotOffset + index + 1,
    alive: health > 0,
    health,
    armor: index % 2 === 0 ? 100 : 0,
    helmet: index % 2 === 0,
    defuseKit: side === 'CT' && index < 3,
    flashed: 0,
    burning: 0,
    money: [3400, 800, 12250, 5600, 250][index % 5]!,
    equipmentValue: [4700, 1200, 5900, 3800, 200][index % 5]!,
    weapons: [
      {
        name: 'weapon_ak47',
        label: 'AK-47',
        type: 'Rifle',
        state: 'active',
        ammoClip: 24,
        ammoClipMax: 30,
        ammoReserve: 90
      }
    ],
    grenades: [
      { name: 'weapon_flashbang', label: 'Flash', count: index % 3 === 0 ? 2 : 1 },
      { name: 'weapon_smokegrenade', label: 'Fumigène', count: 1 },
      { name: 'weapon_molotov', label: 'Molotov', count: index % 2 }
    ].filter((g) => g.count > 0),
    stats: {
      kills: [21, 14, 9, 17, 5][index % 5]!,
      assists: [4, 7, 2, 3, 6][index % 5]!,
      deaths: [11, 15, 13, 10, 18][index % 5]!,
      mvps: [4, 1, 0, 3, 0][index % 5]!,
      score: [48, 31, 22, 40, 17][index % 5]!,
      adr: [92.4, 71.2, 55.8, 84.1, 43.6][index % 5]!,
      headshotKills: [12, 6, 4, 9, 1][index % 5]!,
      headshotPercent: [57.1, 42.9, 44.4, 52.9, 20][index % 5]!,
      kd: [1.91, 0.93, 0.69, 1.7, 0.28][index % 5]!
    },
    roundKills: index === 0 ? 3 : 0,
    roundHeadshots: index === 0 ? 2 : 0,
    roundDamage: index === 0 ? 287 : 42,
    // Positions réparties sur Mirage, pour que le radar ait quelque chose à dire.
    position: [-1200 + index * 380, 400 - slotOffset * 900 + index * 120, 0],
    forward: [index % 2 === 0 ? 1 : -1, 0.2, 0],
    isObserved: false,
    ...overrides
  }
}

function makeTeam(
  slot: 'left' | 'right',
  side: Side,
  name: string,
  shortName: string,
  score: number
): ResolvedTeam {
  return {
    slot,
    side,
    name,
    shortName,
    logoUrl: null,
    color: null,
    country: 'FR',
    teamId: `demo-${slot}`,
    score,
    seriesWins: slot === 'left' ? 1 : 0,
    lossBonus: slot === 'left' ? 0 : 2,
    timeoutsRemaining: 4,
    matchPoint: false
  }
}

export function buildDemoState(): HudState {
  const ctPlayers = CT_NAMES.map((name, i) => makePlayer(name, i, 'CT', 0))
  const tPlayers = T_NAMES.map((name, i) => makePlayer(name, i, 'T', 5))

  // Le joueur observé porte la ligne de statistiques du panneau bas.
  ctPlayers[0] = { ...ctPlayers[0]!, isObserved: true }

  const players = [...ctPlayers, ...tPlayers]

  return {
    live: true,
    updatedAt: Date.now(),
    map: {
      name: 'de_mirage',
      label: 'Mirage',
      mode: 'competitive',
      phase: 'live',
      round: 18,
      phaseEndsIn: 47,
      roundWins: Object.fromEntries(
        Array.from({ length: 17 }, (_, i) => [
          String(i + 1),
          i % 3 === 0 ? 't_win_bomb' : 'ct_win_elimination'
        ])
      ),
      overtime: false,
      regulationMR: 12,
      overtimeMR: 3
    },
    phase: 'live',
    bomb: {
      state: 'planted',
      countdown: 22.4,
      site: 'A',
      playerSteamId: tPlayers[0]!.steamId,
      position: [-450, 180, 0],
      defuseTooLate: false
    },
    teams: {
      left: makeTeam('left', 'CT', 'Citron Esport', 'CIT', 9),
      right: makeTeam('right', 'T', 'Bergamote Gaming', 'BRG', 8)
    },
    players,
    observed: ctPlayers[0]!,
    killfeed: [],
    event: { name: 'Citron Invitational', stage: 'Demi-finale' },
    series: {
      format: 'bo3',
      maps: [
        { mapName: 'de_ancient', label: 'Ancient', played: true, left: 13, right: 8, winner: 'left' },
        { mapName: 'de_mirage', label: 'Mirage', played: false, left: 9, right: 8, winner: null },
        { mapName: 'de_nuke', label: 'Nuke', played: false, left: null, right: null, winner: null }
      ]
    },
    sides: { mode: 'auto', leftSide: 'CT', confidence: 1, matchedPlayers: 10 }
  }
}

/**
 * Injecte la scène et rejoue périodiquement quelques évènements.
 *
 * Le compte à rebours de bombe avance réellement : c'est le seul moyen de
 * vérifier que le pépin se vide correctement et que le chrono ne saute pas.
 */
export function loadDemoScene(): void {
  const store = useOverlay.getState()
  const base = buildDemoState()
  store.setHud(base)
  store.setConnected(true)

  let countdown = base.bomb?.countdown ?? 40

  setInterval(() => {
    countdown = countdown > 0.2 ? countdown - 0.1 : 40
    const current = useOverlay.getState().hud
    if (!current?.bomb) return
    useOverlay.getState().setHud({
      ...current,
      updatedAt: Date.now(),
      bomb: { ...current.bomb, countdown: Number(countdown.toFixed(1)) }
    })
  }, 100)

  // Un kill toutes les 6 s, pour éprouver l'entrée et l'expiration du feed.
  let tick = 0
  setInterval(() => {
    const current = useOverlay.getState().hud
    if (!current) return
    const killer = current.players[tick % 5]!
    const victim = current.players[5 + (tick % 5)]!
    useOverlay.getState().pushKills([
      {
        id: `demo-kill-${tick}`,
        at: Date.now(),
        round: current.map?.round ?? 0,
        killer: {
          steamId: killer.steamId,
          name: killer.name,
          side: killer.side,
          slot: killer.slot
        },
        victim: {
          steamId: victim.steamId,
          name: victim.name,
          side: victim.side,
          slot: victim.slot
        },
        assister: null,
        weapon: 'weapon_ak47',
        weaponLabel: 'AK-47',
        headshot: tick % 2 === 0,
        teamkill: false,
        suicide: false
      }
    ])
    if (tick % 4 === 3) useOverlay.getState().burst('center', 1)
    tick += 1
  }, 6000)
}
