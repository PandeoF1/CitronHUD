import type { Side, SideAssignment, Slot } from '@citronhud/contracts'
import type { NormalizedFrame } from './types'

/**
 * Détection automatique des camps par SteamID.
 *
 * Le problème : l'écran a une gauche et une droite, le jeu a un CT et un T. Les
 * deux s'inversent à la mi-temps, et le serveur ne dit jamais quelle équipe du
 * roster joue quel camp.
 *
 * La solution : chaque joueur en jeu est rattaché à une équipe du roster via son
 * SteamID, puis on vote. Si quatre joueurs de l'équipe de gauche sont CT et
 * quatre joueurs de l'équipe de droite sont T, l'équipe de gauche est CT — avec
 * une confiance de 8/8.
 *
 * Conséquence importante : la mi-temps ne demande aucune logique dédiée. Les
 * joueurs changent réellement de camp dans le flux, donc le vote bascule tout
 * seul. C'est plus robuste que de compter les manches, qui casse dès qu'une
 * prolongation ou une reprise sur sauvegarde s'en mêle.
 */

export interface SideDetectionContext {
  /** SteamID → identifiant d'équipe au roster. */
  playerTeam: ReadonlyMap<string, string>
  leftTeamId: string | null
  rightTeamId: string | null
}

export interface SideDetectorOptions {
  /**
   * Trames consécutives d'accord requises avant de basculer.
   *
   * Le GSI émet environ dix trames par seconde : cinq trames valent une demi-
   * seconde. Assez pour absorber une trame aberrante, assez court pour que la
   * bascule de mi-temps passe inaperçue.
   */
  stabilityFrames?: number
  /** Confiance minimale pour accepter une bascule automatique. */
  minConfidence?: number
}

export interface SideEvidence {
  leftSide: Side
  confidence: number
  matchedPlayers: number
  /** Vrai quand aucun joueur en jeu n'a pu être rattaché au roster. */
  blind: boolean
}

/**
 * Calcule le camp le plus probable de l'équipe de gauche à partir d'une trame.
 *
 * Fonction pure, sans état : testable seule et réutilisée par le panneau de
 * contrôle pour afficher un diagnostic avant même le lancement du HUD.
 */
export function detectSides(
  frame: NormalizedFrame,
  context: SideDetectionContext
): SideEvidence {
  const { playerTeam, leftTeamId, rightTeamId } = context

  if (!leftTeamId && !rightTeamId) {
    return { leftSide: 'CT', confidence: 0, matchedPlayers: 0, blind: true }
  }

  /* Voix en faveur de « gauche = CT » et de « gauche = T ». */
  let leftIsCt = 0
  let leftIsT = 0
  let matched = 0

  for (const player of frame.players) {
    const teamId = playerTeam.get(player.steamId)
    if (!teamId) continue

    const isLeft = teamId === leftTeamId
    const isRight = teamId === rightTeamId
    if (!isLeft && !isRight) continue

    matched++

    /*
     * Un joueur de gauche en CT et un joueur de droite en T disent la même
     * chose : que la gauche est CT. Les deux comptent donc pour la même voix.
     */
    if ((isLeft && player.side === 'CT') || (isRight && player.side === 'T')) leftIsCt++
    else leftIsT++
  }

  if (matched === 0) {
    return { leftSide: 'CT', confidence: 0, matchedPlayers: 0, blind: true }
  }

  const leftSide: Side = leftIsCt >= leftIsT ? 'CT' : 'T'
  const winning = Math.max(leftIsCt, leftIsT)

  return {
    leftSide,
    confidence: winning / matched,
    matchedPlayers: matched,
    blind: false
  }
}

/**
 * Détecteur avec mémoire.
 *
 * Ajoute au calcul pur l'hystérésis et le mode manuel : sans hystérésis, une
 * seule trame incomplète — fréquentes lors d'une reconnexion — inverserait tout
 * le HUD pendant un dixième de seconde à l'antenne.
 */
export class SideDetector {
  private assignment: SideAssignment
  private pendingSide: Side | null = null
  private pendingFrames = 0
  private readonly stabilityFrames: number
  private readonly minConfidence: number

  constructor(initial?: Partial<SideAssignment>, options: SideDetectorOptions = {}) {
    this.stabilityFrames = options.stabilityFrames ?? 5
    this.minConfidence = options.minConfidence ?? 0.6
    this.assignment = {
      mode: initial?.mode ?? 'auto',
      leftSide: initial?.leftSide ?? 'CT',
      confidence: initial?.confidence ?? 0,
      matchedPlayers: initial?.matchedPlayers ?? 0,
      overridden: initial?.overridden ?? false,
      updatedAt: initial?.updatedAt ?? null
    }
  }

  get current(): SideAssignment {
    return this.assignment
  }

  /** Position d'écran d'un camp — la fonction que consomme tout le reste. */
  slotOf = (side: Side): Slot => {
    return side === this.assignment.leftSide ? 'left' : 'right'
  }

  /** Camp occupé par une position d'écran. */
  sideOf(slot: Slot): Side {
    if (slot === 'left') return this.assignment.leftSide
    return this.assignment.leftSide === 'CT' ? 'T' : 'CT'
  }

  update(frame: NormalizedFrame, context: SideDetectionContext): SideAssignment {
    const evidence = detectSides(frame, context)

    /*
     * En manuel, l'opérateur a tranché : on ne touche pas à l'affectation. On
     * continue toutefois à publier la confiance mesurée, pour que le panneau
     * puisse signaler « la détection automatique n'est pas d'accord avec vous ».
     */
    if (this.assignment.mode === 'manual') {
      this.assignment = {
        ...this.assignment,
        confidence: evidence.confidence,
        matchedPlayers: evidence.matchedPlayers
      }
      return this.assignment
    }

    if (evidence.blind) {
      this.assignment = { ...this.assignment, confidence: 0, matchedPlayers: 0 }
      return this.assignment
    }

    if (evidence.leftSide === this.assignment.leftSide) {
      this.pendingSide = null
      this.pendingFrames = 0
      this.assignment = {
        ...this.assignment,
        confidence: evidence.confidence,
        matchedPlayers: evidence.matchedPlayers
      }
      return this.assignment
    }

    if (evidence.confidence < this.minConfidence) {
      this.pendingSide = null
      this.pendingFrames = 0
      this.assignment = {
        ...this.assignment,
        confidence: evidence.confidence,
        matchedPlayers: evidence.matchedPlayers
      }
      return this.assignment
    }

    // Désaccord franc et répété : on bascule.
    if (this.pendingSide === evidence.leftSide) this.pendingFrames++
    else {
      this.pendingSide = evidence.leftSide
      this.pendingFrames = 1
    }

    if (this.pendingFrames >= this.stabilityFrames) {
      this.assignment = {
        mode: 'auto',
        leftSide: evidence.leftSide,
        confidence: evidence.confidence,
        matchedPlayers: evidence.matchedPlayers,
        overridden: false,
        updatedAt: new Date().toISOString()
      }
      this.pendingSide = null
      this.pendingFrames = 0
      return this.assignment
    }

    this.assignment = {
      ...this.assignment,
      confidence: evidence.confidence,
      matchedPlayers: evidence.matchedPlayers
    }
    return this.assignment
  }

  /**
   * Inverse les camps à la main.
   *
   * Bascule en mode manuel : sans cela, la détection automatique remettrait
   * l'affectation d'origine à la trame suivante et l'opérateur aurait
   * l'impression que le bouton ne marche pas.
   */
  swap(): SideAssignment {
    this.assignment = {
      mode: 'manual',
      leftSide: this.assignment.leftSide === 'CT' ? 'T' : 'CT',
      confidence: this.assignment.confidence,
      matchedPlayers: this.assignment.matchedPlayers,
      overridden: true,
      updatedAt: new Date().toISOString()
    }
    this.pendingSide = null
    this.pendingFrames = 0
    return this.assignment
  }

  /** Rend la main à la détection automatique. */
  setAuto(): SideAssignment {
    this.assignment = {
      ...this.assignment,
      mode: 'auto',
      overridden: false,
      updatedAt: new Date().toISOString()
    }
    this.pendingSide = null
    this.pendingFrames = 0
    return this.assignment
  }

  setManual(leftSide: Side): SideAssignment {
    this.assignment = {
      ...this.assignment,
      mode: 'manual',
      leftSide,
      overridden: true,
      updatedAt: new Date().toISOString()
    }
    this.pendingSide = null
    this.pendingFrames = 0
    return this.assignment
  }
}
