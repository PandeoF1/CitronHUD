/**
 * @citronhud/contracts
 *
 * Source de vérité unique des formes de données du projet. Le client Electron,
 * l'overlay et le serveur importent tous d'ici : un champ renommé casse la
 * compilation partout au lieu de produire un `undefined` silencieux en direct.
 */
export * from './common'
export * from './roster'
export * from './match'
export * from './hud-state'
export * from './highlight'
export * from './record'
export * from './config'
export * from './socket'
export * from './api'
