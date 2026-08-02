import { z } from 'zod'
import { hexColorSchema } from './common'
import { highlightKindSchema } from './highlight'

/**
 * Configuration — deux niveaux distincts.
 *
 * `HudConfig` : ce qui change l'apparence de l'overlay, modifiable en direct
 * pendant un match sans redémarrer quoi que ce soit.
 *
 * `ClientSettings` : ce qui change le fonctionnement du client (serveur, OBS,
 * capture). Réglé une fois à l'installation, rarement retouché.
 */

export const hudConfigSchema = z.object({
  /** Couleurs de camp. Le jaune de marque reste réservé à la structure. */
  ctColor: hexColorSchema.default('#35b0e8'),
  tColor: hexColorSchema.default('#f0703c'),
  /** Utilise la couleur d'équipe du roster à la place de celle du camp. */
  useTeamColors: z.boolean().default(false),

  showRadar: z.boolean().default(true),
  radarScale: z.number().min(0.6).max(1.8).default(1),
  /** Traînées d'utilitaires, fumées et nappes de feu sur le radar. */
  showGrenades: z.boolean().default(true),
  /**
   * Lissage des positions du radar.
   *
   * Le GSI envoie au mieux une dizaine de trames par seconde ; sans
   * interpolation, les pastilles avancent par saccades bien visibles à côté du
   * jeu qui tourne à 60 images par seconde et plus. Désactivable pour les
   * machines qui n'ont pas de marge côté navigateur.
   */
  smoothRadar: z.boolean().default(true),
  showKillfeed: z.boolean().default(true),
  showObservedPanel: z.boolean().default(true),
  showPlayerAvatars: z.boolean().default(true),
  showCountryFlags: z.boolean().default(true),
  showMoney: z.boolean().default(true),
  showSeriesBar: z.boolean().default(true),
  showRoundHistory: z.boolean().default(true),
  showAdr: z.boolean().default(true),

  /** Effets citron : gerbes de zestes sur les temps forts. */
  zestEffects: z.boolean().default(true),
  /** Intensité des particules, de discret à généreux. */
  zestIntensity: z.enum(['subtle', 'normal', 'heavy']).default('normal'),

  /** Lecture automatique des replays à l'antenne. */
  autoPlayReplays: z.boolean().default(true),
  /** Types de temps forts qui déclenchent un replay automatique. */
  replayKinds: z.array(highlightKindSchema).default(['ace', 'clutch', 'ninja_defuse', 'quad_kill']),
  /**
   * Fenêtre pendant laquelle un replay ne peut pas se relancer.
   *
   * Sans ce garde-fou, une manche à trois temps forts enchaîne trois replays et
   * fait rater la manche suivante aux spectateurs.
   */
  replayCooldownMs: z.number().int().min(0).max(120_000).default(25_000),
  /** Ne rejoue jamais pendant une manche en cours ; attend le freezetime. */
  replayOnlyBetweenRounds: z.boolean().default(true),

  showRecordToasts: z.boolean().default(true),

  /** Bilan de fin de manche : vainqueur, MVP, tableau des deux équipes. */
  showRoundReview: z.boolean().default(true),
  /**
   * Durée d'affichage du bilan, en millisecondes.
   *
   * La phase « over » dure environ sept secondes en compétitif ; au-delà, le
   * bilan mordrait sur les achats du temps de gel, qui sont eux aussi du
   * contenu à commenter.
   */
  roundReviewMs: z.number().int().min(0).max(15_000).default(5_000),

  /** Décalage vertical global, pour dégager une bannière de chaîne. */
  offsetY: z.number().int().min(-200).max(200).default(0),
  /** Échelle de rendu ; 1 correspond à un canevas 1920×1080. */
  scale: z.number().min(0.5).max(2).default(1),
  /** Coins vifs : désactive la grammaire chanfreinée pour un rendu neutre. */
  sharpCorners: z.boolean().default(false)
})
export type HudConfig = z.infer<typeof hudConfigSchema>

export const defaultHudConfig: HudConfig = hudConfigSchema.parse({})

export const obsSettingsSchema = z.object({
  enabled: z.boolean().default(true),
  host: z.string().default('127.0.0.1'),
  port: z.number().int().min(1).max(65535).default(4455),
  /**
   * Mot de passe websocket.
   *
   * Laissé vide par défaut : le client tente d'abord de le lire dans la config
   * d'OBS sur le disque. C'est le cœur du « zéro réglage » — demander un mot de
   * passe dès le premier lancement suffit à faire abandonner un streamer.
   */
  password: z.string().default(''),
  /** Le client a trouvé le mot de passe tout seul. */
  autoDiscovered: z.boolean().default(false),
  /** Crée et met à jour la source navigateur du HUD dans la scène active. */
  manageBrowserSource: z.boolean().default(true),
  browserSourceName: z.string().default('CitronHUD'),
  /** Active et configure le tampon de replay d'OBS au démarrage. */
  manageReplayBuffer: z.boolean().default(true),
  replayBufferSeconds: z.number().int().min(10).max(120).default(45)
})
export type ObsSettings = z.infer<typeof obsSettingsSchema>

export const captureSettingsSchema = z.object({
  /**
   * `obs` : qualité maximale, dépend d'OBS.
   * `internal` : capture par le client, marche partout mais coûte des ressources.
   * `auto` : OBS s'il répond, repli interne sinon.
   */
  mode: z.enum(['auto', 'obs', 'internal', 'off']).default('auto'),
  /** Durée du tampon circulaire de la capture interne. */
  internalBufferSeconds: z.number().int().min(10).max(90).default(40),
  internalFps: z.number().int().min(24).max(60).default(30),
  internalHeight: z.number().int().min(480).max(1440).default(900),
  /** Découpe le clip à la fenêtre exacte du temps fort. */
  trimToWindow: z.boolean().default(true),
  /** Téléverse les clips vers le serveur quand il répond. */
  uploadToServer: z.boolean().default(true),
  /** Nombre de clips conservés localement avant purge du plus ancien. */
  keepLocalClips: z.number().int().min(0).max(500).default(60)
})
export type CaptureSettings = z.infer<typeof captureSettingsSchema>

export const clientSettingsSchema = z.object({
  /**
   * URL du serveur CitronHUD.
   *
   * Vide = mode entièrement local : le streamer gère ses équipes depuis le
   * client et rien ne sort de sa machine.
   */
  serverUrl: z.string().default(''),
  /** Jeton d'accès délivré par l'admin. */
  apiKey: z.string().default(''),
  /** Intervalle de resynchronisation du roster. */
  syncIntervalMs: z.number().int().min(30_000).max(3_600_000).default(300_000),

  /** Port du serveur local qui sert l'overlay à OBS. */
  hudPort: z.number().int().min(1024).max(65535).default(3477),
  /** Port d'écoute du Game State Integration de CS2. */
  gsiPort: z.number().int().min(1024).max(65535).default(23477),

  /** Chemin d'installation de Steam, détecté puis modifiable. */
  steamPath: z.string().nullable().default(null),
  /** Le fichier de configuration GSI a été écrit dans CS2. */
  gsiInstalled: z.boolean().default(false),

  obs: obsSettingsSchema.default(obsSettingsSchema.parse({})),
  capture: captureSettingsSchema.default(captureSettingsSchema.parse({})),

  /** Vérifie et installe les mises à jour du client au démarrage. */
  autoUpdate: z.boolean().default(true),
  /** Canal de publication ; `beta` reçoit les préversions. */
  updateChannel: z.enum(['stable', 'beta']).default('stable'),
  /** Récupère la dernière version de l'overlay sans réinstaller le client. */
  autoUpdateOverlay: z.boolean().default(true),

  language: z.enum(['fr', 'en']).default('fr')
})
export type ClientSettings = z.infer<typeof clientSettingsSchema>

export const defaultClientSettings: ClientSettings = clientSettingsSchema.parse({})

/** État de connexion remonté au panneau de contrôle. */
export const connectionStatusSchema = z.object({
  gsi: z.enum(['waiting', 'live', 'stale']),
  /** `local` quand aucun serveur n'est configuré : ce n'est pas une erreur. */
  server: z.enum(['local', 'online', 'offline', 'unauthorized', 'syncing']),
  obs: z.enum(['disabled', 'connecting', 'connected', 'unreachable', 'auth_failed']),
  overlay: z.object({
    connected: z.number().int(),
    url: z.string()
  }),
  capture: z.enum(['off', 'obs', 'internal', 'unavailable']),
  lastSyncAt: z.string().nullable(),
  lastGsiAt: z.string().nullable()
})
export type ConnectionStatus = z.infer<typeof connectionStatusSchema>
