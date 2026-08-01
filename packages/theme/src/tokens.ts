/**
 * Design system « Zeste » — source de vérité des tokens.
 *
 * Ce fichier est la SEULE source de vérité. `src/css/tokens.css` en est généré
 * par `scripts/build-tokens.mjs` — ne jamais éditer le CSS à la main.
 *
 * Principe directeur : un citron n'est pas « du jaune ». Il a une peau saturée
 * et chaude (rind), un zeste plus clair (zest), une peau blanche crémeuse (pith),
 * une chair mate (pulp), une feuille verte (leaf) et des pépins sombres (seed).
 * Toute la palette sombre est donc *chaude*, jamais bleutée : c'est ce qui
 * distingue l'identité d'un simple « accent acide sur noir ».
 */

/** Anatomie du citron — surfaces, du plus profond au plus clair. */
export const surface = {
  /** Scrims, fonds de modale, backdrop plein écran. */
  seed: '#0A0906',
  /** Fond de page (interface admin). */
  char: '#12100A',
  /** Surface des panneaux du HUD. */
  flesh: '#1B1810',
  /** Surface surélevée : lignes de tableau, cartes joueur. */
  husk: '#262117',
  /** Bordures, séparateurs, contours discrets. */
  shell: '#3A3324'
} as const

/** Accents de marque — réservés à la STRUCTURE, jamais à une équipe. */
export const brand = {
  /** La signature. Arêtes chanfreinées, focus, chrono, le pépin. */
  rind: '#FFC800',
  /** Survol, éclats, cœur des particules. */
  zest: '#FFE45C',
  /** Rind assombri, pour les états pressés / désactivés. */
  peel: '#C99A00'
} as const

/** Texte — crème chaude plutôt que blanc pur. */
export const ink = {
  /** Texte primaire sur fond sombre. */
  pith: '#F3EEDC',
  /** Texte secondaire, labels. */
  pulp: '#A79E85',
  /** Texte tertiaire, désactivé. */
  rind_dim: '#6E6752',
  /** Uniquement pour les valeurs critiques (HP, chrono) où le contraste prime. */
  white: '#FFFFFF',
  /** Texte sur fond citron. */
  on_rind: '#171307'
} as const

/**
 * Couleurs d'équipe par défaut.
 *
 * Délibérément à l'écart du jaune de marque : le jaune ne doit jamais signifier
 * « une équipe », sinon le spectateur confond la structure et le camp.
 * L'opérateur peut les remplacer depuis le panneau de configuration du HUD.
 */
export const side = {
  ct: '#35B0E8',
  ct_deep: '#1B6E95',
  t: '#F0703C',
  t_deep: '#9C3F1B'
} as const

/** Sémantique de jeu. */
export const semantic = {
  /** Feuille de citronnier — vivant, succès, argent. */
  leaf: '#4FA96B',
  leaf_deep: '#2E7D4F',
  /** HP bas, dégâts. */
  blood: '#FF4438',
  /** Bombe plantée. */
  bomb: '#FF3B30',
  /** Désamorçage en cours. */
  defuse: '#35B0E8',
  /** Flash / aveuglement. */
  flash: '#F3EEDC',
  /** Molotov / incendiaire. */
  fire: '#FF8A3D',
  /** Fumigène. */
  smoke: '#9AA0A6',
  /** Avertissement. */
  warn: '#FFB020'
} as const

/** Opacités standard des voiles garantissant la lisibilité sur la vidéo. */
export const scrim = {
  /** Voile sous les panneaux légers. */
  soft: 'rgba(10, 9, 6, 0.62)',
  /** Voile sous les panneaux denses (listes joueurs). */
  firm: 'rgba(10, 9, 6, 0.82)',
  /** Voile plein écran (replay, pause). */
  full: 'rgba(10, 9, 6, 0.94)'
} as const

/**
 * Typographie.
 *
 * Archivo est variable sur DEUX axes (wght 100-900, wdth 62-125) : une seule
 * famille couvre l'affichage large du score et les noms de joueurs condensés.
 * Chivo Mono (même fonderie, Omnibus-Type) porte les chiffres tabulaires.
 */
export const font = {
  display: "'Archivo Variable', 'Archivo', 'Helvetica Neue', Arial, sans-serif",
  body: "'Archivo Variable', 'Archivo', 'Helvetica Neue', Arial, sans-serif",
  mono: "'Chivo Mono Variable', 'Chivo Mono', ui-monospace, 'SF Mono', Menlo, monospace"
} as const

/** Axes de largeur d'Archivo, par rôle. */
export const width = {
  /** Score principal — large, occupe l'espace. */
  expanded: 112,
  /** Titres, noms d'équipe. */
  normal: 100,
  /** Noms de joueurs, listes denses. */
  condensed: 84,
  /** Cas extrêmes : noms très longs. */
  narrow: 70
} as const

/**
 * Échelle typographique du HUD, en pixels absolus.
 *
 * L'overlay est rendu à une résolution fixe (1920×1080 par défaut) puis mis à
 * l'échelle par `transform: scale()`. Les rem n'auraient donc aucun intérêt ici :
 * ces valeurs sont des px de canevas, pas des px d'écran.
 */
export const hudType = {
  score: { size: 62, weight: 800, width: width.expanded, tracking: '-0.02em' },
  timer: { size: 34, weight: 700, width: width.normal, tracking: '0.01em' },
  teamName: { size: 25, weight: 700, width: 92, tracking: '0.005em' },
  observedName: { size: 30, weight: 700, width: 90, tracking: '0' },
  playerName: { size: 17, weight: 600, width: width.condensed, tracking: '0.01em' },
  stat: { size: 14, weight: 500, width: width.normal, tracking: '0.02em' },
  money: { size: 15, weight: 600, width: width.condensed, tracking: '0.01em' },
  eyebrow: { size: 11, weight: 700, width: width.normal, tracking: '0.16em' },
  micro: { size: 10, weight: 600, width: width.condensed, tracking: '0.12em' }
} as const

/** Échelle typographique de l'interface admin (rem, responsive classique). */
export const uiType = {
  display: { size: '2.5rem', weight: 800, width: width.expanded, tracking: '-0.02em' },
  h1: { size: '1.75rem', weight: 700, width: width.normal, tracking: '-0.01em' },
  h2: { size: '1.25rem', weight: 700, width: width.normal, tracking: '0' },
  body: { size: '0.9375rem', weight: 400, width: width.normal, tracking: '0' },
  small: { size: '0.8125rem', weight: 500, width: width.normal, tracking: '0.01em' },
  eyebrow: { size: '0.6875rem', weight: 700, width: width.normal, tracking: '0.16em' }
} as const

/**
 * Le chanfrein — la grammaire de forme du système.
 *
 * Toute surface est un rectangle dont un ou plusieurs coins sont coupés à 45°.
 * Une taille unique par échelle : la constance est ce qui rend la forme
 * reconnaissable. Un chanfrein arbitraire par composant détruirait l'effet.
 */
export const chamfer = {
  /** Puces, badges. */
  xs: 6,
  /** Boutons, cartes joueur. */
  sm: 10,
  /** Panneaux standard. */
  md: 16,
  /** Matchbar, cadre de replay. */
  lg: 26
} as const

/** Épaisseur de l'arête zeste sur le bord chanfreiné. */
export const edge = {
  hair: 1,
  regular: 2,
  bold: 3
} as const

export const space = {
  0: '0px',
  1: '2px',
  2: '4px',
  3: '8px',
  4: '12px',
  5: '16px',
  6: '24px',
  7: '32px',
  8: '48px',
  9: '64px'
} as const

/**
 * Durées et courbes.
 *
 * Un HUD de diffusion ne s'anime QUE sur changement d'état. Aucune animation
 * d'ambiance : sur 40 minutes de match, le mouvement continu est épuisant et
 * vole l'attention au jeu.
 */
export const motion = {
  duration: {
    /** Changement de valeur (HP, argent). */
    tick: '120ms',
    /** Entrée/sortie d'un élément. */
    swap: '220ms',
    /** Panneau qui apparaît. */
    panel: '380ms',
    /** Transition de replay (squeeze). */
    squeeze: '720ms',
    /** Toast de record. */
    toast: '520ms'
  },
  ease: {
    /** Sortie standard — décélération franche. */
    out: 'cubic-bezier(0.16, 1, 0.3, 1)',
    /** Entrée — accélération. */
    in: 'cubic-bezier(0.7, 0, 0.84, 0)',
    /** Aller-retour. */
    inOut: 'cubic-bezier(0.65, 0, 0.35, 1)',
    /** Le « squeeze » : compression brutale puis relâchement élastique. */
    squeeze: 'cubic-bezier(0.34, 1.56, 0.64, 1)'
  }
} as const

/** Halos — utilisés avec parcimonie, uniquement sur les états actifs. */
export const glow = {
  rind: '0 0 0 1px rgba(255, 200, 0, 0.5), 0 0 18px -4px rgba(255, 200, 0, 0.55)',
  blood: '0 0 0 1px rgba(255, 68, 56, 0.55), 0 0 22px -6px rgba(255, 68, 56, 0.7)',
  lift: '0 12px 32px -12px rgba(0, 0, 0, 0.85)'
} as const

/** Couche z de l'overlay. */
export const layer = {
  radar: 10,
  roster: 20,
  matchbar: 30,
  observed: 40,
  killfeed: 50,
  toast: 60,
  particles: 70,
  replay: 80
} as const

/** Le token bundle complet, pour la génération CSS et les consommateurs JS. */
export const tokens = {
  surface,
  brand,
  ink,
  side,
  semantic,
  scrim,
  font,
  width,
  hudType,
  uiType,
  chamfer,
  edge,
  space,
  motion,
  glow,
  layer
} as const

export type Tokens = typeof tokens
