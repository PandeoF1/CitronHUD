import { create } from 'zustand'
import type { Highlight, HudConfig, HudState, KillEvent, RecordBroken } from '@citronhud/contracts'
import { defaultHudConfig } from '@citronhud/contracts'

/**
 * État de l'overlay.
 *
 * Deux natures de données cohabitent et se comportent différemment :
 *
 *  - L'ÉTAT (`hud`) est remplacé intégralement à chaque trame. Aucune fusion,
 *    aucune accumulation : le client envoie la vérité complète dix fois par
 *    seconde.
 *  - Les ÉVÈNEMENTS (kills, records, replays) s'accumulent et expirent. Les
 *    rejouer à chaque trame relancerait leurs animations d'entrée en boucle.
 */

/** Durée d'affichage d'un kill dans le feed. */
const KILL_TTL_MS = 7000
/** Nombre maximum de kills affichés simultanément. */
const KILL_LIMIT = 5
/** Durée d'affichage d'un bandeau de record. */
const RECORD_TTL_MS = 6000

export interface TimedKill extends KillEvent {
  /** Date d'affichage locale, indépendante de l'horodatage du jeu. */
  shownAt: number
}

export interface ActiveReplay {
  highlight: Highlight
  clipUrl: string
  durationMs: number
  startedAt: number
}

export interface ZestBurst {
  id: number
  origin: 'left' | 'right' | 'center'
  intensity: number
  at: number
}

interface OverlayState {
  hud: HudState | null
  config: HudConfig
  /** Vrai tant que la liaison avec le client local tient. */
  connected: boolean

  kills: TimedKill[]
  records: Array<RecordBroken & { id: number; shownAt: number }>
  replay: ActiveReplay | null
  /** Temps fort détecté dont le clip n'est pas encore prêt. */
  pendingHighlight: Highlight | null
  bursts: ZestBurst[]

  setHud: (hud: HudState) => void
  setConfig: (config: HudConfig) => void
  setConnected: (connected: boolean) => void
  pushKills: (kills: KillEvent[]) => void
  pushRecord: (record: RecordBroken) => void
  setPendingHighlight: (highlight: Highlight | null) => void
  startReplay: (replay: Omit<ActiveReplay, 'startedAt'>) => void
  stopReplay: () => void
  burst: (origin: 'left' | 'right' | 'center', intensity: number) => void
  prune: () => void
}

let sequence = 0

export const useOverlay = create<OverlayState>((set) => ({
  hud: null,
  config: defaultHudConfig,
  connected: false,
  kills: [],
  records: [],
  replay: null,
  pendingHighlight: null,
  bursts: [],

  setHud: (hud) => set({ hud }),
  setConfig: (config) => set({ config }),
  setConnected: (connected) => set({ connected }),

  pushKills: (incoming) =>
    set((state) => {
      if (incoming.length === 0) return state
      const now = Date.now()
      const known = new Set(state.kills.map((kill) => kill.id))
      const fresh = incoming
        .filter((kill) => !known.has(kill.id))
        .map((kill) => ({ ...kill, shownAt: now }))
      if (fresh.length === 0) return state
      return { kills: [...state.kills, ...fresh].slice(-KILL_LIMIT) }
    }),

  pushRecord: (record) =>
    set((state) => ({
      records: [...state.records, { ...record, id: ++sequence, shownAt: Date.now() }]
    })),

  setPendingHighlight: (pendingHighlight) => set({ pendingHighlight }),

  startReplay: (replay) =>
    set({ replay: { ...replay, startedAt: Date.now() }, pendingHighlight: null }),
  stopReplay: () => set({ replay: null }),

  burst: (origin, intensity) =>
    set((state) => ({
      bursts: [...state.bursts, { id: ++sequence, origin, intensity, at: Date.now() }].slice(-6)
    })),

  /**
   * Purge les évènements expirés.
   *
   * Appelée par une horloge unique plutôt que par un `setTimeout` posé à chaque
   * évènement : sur un match complet, des centaines de timers en vol finiraient
   * par peser sur la source navigateur.
   */
  prune: () =>
    set((state) => {
      const now = Date.now()
      const kills = state.kills.filter((kill) => now - kill.shownAt < KILL_TTL_MS)
      const records = state.records.filter((record) => now - record.shownAt < RECORD_TTL_MS)
      const bursts = state.bursts.filter((burst) => now - burst.at < 2000)

      if (
        kills.length === state.kills.length &&
        records.length === state.records.length &&
        bursts.length === state.bursts.length
      ) {
        return state
      }
      return { kills, records, bursts }
    })
}))
