import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { connectOverlay } from './state/socket'
import { loadDemoScene } from './state/demo'
import './styles/overlay.css'

/**
 * Point d'entrée de l'overlay.
 *
 * Trois modes de démarrage :
 *  - normal         : on se branche au client local, qui pousse l'état ;
 *  - `?demo=1`      : on charge une scène fabriquée, pour travailler l'apparence
 *                     sans lancer CS2. Un HUD ne se dessine pas à vide, et exiger
 *                     une partie en cours pour ajuster un espacement est le
 *                     meilleur moyen de ne jamais l'ajuster ;
 *  - `?demo=review` : la même scène, en fin de manche. Le bilan ne dure que
 *                     quelques secondes en jeu, ce qui laisse trop peu de temps
 *                     pour en régler la mise en page.
 */
const params = new URLSearchParams(window.location.search)
const demo = params.get('demo')

if (demo === '1' || demo === 'review') {
  loadDemoScene({ roundReview: demo === 'review' })
} else {
  connectOverlay()
}

const container = document.getElementById('root')
if (!container) throw new Error("L'élément #root est introuvable dans index.html")

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>
)
