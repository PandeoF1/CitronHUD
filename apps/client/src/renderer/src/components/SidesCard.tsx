import type { HudState, MatchSetup } from '@citronhud/contracts'

/**
 * Détection des camps.
 *
 * Le point délicat du HUD, et la raison pour laquelle cette carte existe :
 * l'écran a une gauche et une droite, le jeu a un CT et un T, et les deux ne
 * coïncident pas — ils s'inversent à la mi-temps, et une équipe peut être mal
 * reconnue s'il manque des SteamID au roster.
 *
 * On affiche donc explicitement la fiabilité plutôt que de laisser l'opérateur
 * découvrir l'erreur à l'antenne.
 */

interface SidesCardProps {
  match: MatchSetup
  state: HudState | null
  onSwap: () => void
  onModeChange: (mode: 'auto' | 'manual') => void
}

/** Sous ce seuil, il manque assez de SteamID pour que la détection se trompe. */
const SHAKY_CONFIDENCE = 0.6

export function SidesCard({ match, state, onSwap, onModeChange }: SidesCardProps) {
  // L'état en direct fait foi quand il existe : c'est le calcul de la dernière
  // trame, alors que le match persisté peut dater d'avant le lancement de CS2.
  const sides = state?.sides ?? match.sides
  const shaky = sides.mode === 'auto' && sides.confidence < SHAKY_CONFIDENCE
  const percent = Math.round(sides.confidence * 100)

  return (
    <section className="card">
      <h2 className="card__title">Camps</h2>

      <div className="sides">
        <div className="sides__readout">
          <span className="sides__label">Équipe de gauche</span>
          <strong className="sides__value" data-side={sides.leftSide}>
            {sides.leftSide}
          </strong>
        </div>

        <div className="sides__readout">
          <span className="sides__label">Détection</span>
          <strong className="sides__value">
            {sides.mode === 'auto' ? `Automatique · ${percent} %` : 'Manuelle'}
          </strong>
        </div>

        <div className="sides__readout">
          <span className="sides__label">Joueurs reconnus</span>
          <strong className="sides__value">{sides.matchedPlayers} / 10</strong>
        </div>
      </div>

      {shaky && (
        <p className="warn">
          Détection peu fiable : {sides.matchedPlayers} joueurs seulement sont reconnus par leur
          SteamID. Ajoutez-les au roster, ou fixez les camps à la main.
        </p>
      )}

      <div className="actions">
        <button className="btn" onClick={onSwap}>
          Inverser les camps
        </button>
        <button
          className="btn btn--ghost"
          onClick={() => onModeChange(sides.mode === 'auto' ? 'manual' : 'auto')}
        >
          {sides.mode === 'auto' ? 'Figer en manuel' : 'Repasser en automatique'}
        </button>
      </div>

      <p className="card__hint">
        En automatique, les camps se recalculent à chaque trame — la mi-temps est donc suivie toute
        seule. Inverser à la main fige la détection jusqu’au retour en automatique.
      </p>
    </section>
  )
}
