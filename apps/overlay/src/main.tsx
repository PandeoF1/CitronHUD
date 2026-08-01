import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { connectOverlay } from './state/socket'
import { loadDemoScene } from './state/demo'
import './styles/overlay.css'

/**
 * Point d'entrée de l'overlay.
 *
 * Deux modes de démarrage :
 *  - normal    : on se branche au client local, qui pousse l'état ;
 *  - `?demo=1` : on charge une scène fabriquée, pour travailler l'apparence
 *                sans lancer CS2. Un HUD ne se dessine pas à vide, et exiger
 *                une partie en cours pour ajuster un espacement est le meilleur
 *                moyen de ne jamais l'ajuster.
 */
const params = new URLSearchParams(window.location.search)

if (params.get('demo') === '1') {
  loadDemoScene()
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
