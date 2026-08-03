/**
 * État de retour des actions serveur.
 *
 * Dans son propre module parce qu'un fichier marqué `'use server'` ne peut
 * exporter que des fonctions asynchrones : y laisser la constante `IDLE` fait
 * échouer la compilation avec un message qui ne dit pas pourquoi.
 */
export interface ActionState {
  ok: boolean
  message: string
  /** Renseigné une seule fois, à la création d'une clé d'API. */
  secret?: string
}

export const IDLE: ActionState = { ok: true, message: '' }
