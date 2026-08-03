import { toNextJsHandler } from 'better-auth/next-js'
import { getAuth } from '../../../../lib/auth'

/**
 * Point d'entrée de better-auth.
 *
 * Le handler est construit à la demande et non au chargement du module : `getAuth`
 * ouvre la connexion à la base, ce que `next build` ne doit pas déclencher.
 */
export async function GET(request: Request): Promise<Response> {
  return toNextJsHandler(getAuth()).GET(request)
}

export async function POST(request: Request): Promise<Response> {
  return toNextJsHandler(getAuth()).POST(request)
}
