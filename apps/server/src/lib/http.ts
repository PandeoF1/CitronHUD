import { NextResponse } from 'next/server'
import type { z } from 'zod'

/**
 * Utilitaires de réponse de l'API v1.
 *
 * Toutes les erreurs sortent sous la même forme — `{ error: { code, message } }`
 * décrite par `apiErrorSchema` — pour que le client puisse les traiter sans
 * deviner la structure au cas par cas.
 */

export function json<T>(body: T, init?: ResponseInit): NextResponse {
  return NextResponse.json(body, init)
}

export function fail(
  status: number,
  code: string,
  message: string,
  details?: unknown
): NextResponse {
  return NextResponse.json({ error: { code, message, details } }, { status })
}

export const unauthorized = (message = "Clé d'API absente ou invalide.") =>
  fail(401, 'unauthorized', message)
export const forbidden = (message = 'Droits insuffisants.') => fail(403, 'forbidden', message)
export const notFound = (message = 'Introuvable.') => fail(404, 'not_found', message)

/**
 * Valide un corps JSON.
 *
 * Renvoie soit la valeur analysée, soit une réponse d'erreur déjà formée —
 * l'appelant n'a qu'à la retourner. Le détail Zod est inclus : c'est ce qui
 * permet de comprendre pourquoi une entrée de file d'envoi est refusée depuis
 * les journaux du client, sans accès au serveur.
 */
export async function parseBody<S extends z.ZodType>(
  request: Request,
  schema: S
): Promise<{ data: z.infer<S>; error: null } | { data: null; error: NextResponse }> {
  let raw: unknown
  try {
    raw = await request.json()
  } catch {
    return { data: null, error: fail(400, 'invalid_json', 'Corps de requête JSON illisible.') }
  }

  const result = schema.safeParse(raw)
  if (!result.success) {
    return {
      data: null,
      error: fail(422, 'invalid_body', 'Corps de requête invalide.', result.error.issues)
    }
  }
  return { data: result.data, error: null }
}

/**
 * Valide une modification partielle.
 *
 * Nécessaire parce que `.partial()` de Zod n'annule pas les `.default()` : sur
 * un schéma dont les champs facultatifs valent `null` par défaut, un
 * `PATCH { nickname }` ressort avec `teamId: null`, `avatarUrl: null`,
 * `role: null`… Écrit tel quel en base, il détacherait le joueur de son équipe
 * et effacerait sa photo, alors que l'appelant n'a touché qu'au pseudo.
 *
 * On ne garde donc que les clés réellement envoyées, tout en conservant les
 * transformations du schéma — la normalisation des couleurs, par exemple.
 */
export async function parsePatch<S extends z.ZodType>(
  request: Request,
  schema: S
): Promise<
  { data: Partial<z.infer<S>>; error: null } | { data: null; error: NextResponse }
> {
  let raw: unknown
  try {
    raw = await request.json()
  } catch {
    return { data: null, error: fail(400, 'invalid_json', 'Corps de requête JSON illisible.') }
  }

  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { data: null, error: fail(422, 'invalid_body', 'Un objet est attendu.') }
  }

  const result = schema.safeParse(raw)
  if (!result.success) {
    return {
      data: null,
      error: fail(422, 'invalid_body', 'Corps de requête invalide.', result.error.issues)
    }
  }

  const sent = new Set(Object.keys(raw as Record<string, unknown>))
  const patch: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(result.data as Record<string, unknown>)) {
    if (sent.has(key)) patch[key] = value
  }

  return { data: patch as Partial<z.infer<S>>, error: null }
}

/** Même chose pour les paramètres de requête. */
export function parseQuery<S extends z.ZodType>(
  request: Request,
  schema: S
): { data: z.infer<S>; error: null } | { data: null; error: NextResponse } {
  const params = Object.fromEntries(new URL(request.url).searchParams)
  const result = schema.safeParse(params)
  if (!result.success) {
    return {
      data: null,
      error: fail(422, 'invalid_query', 'Paramètres de requête invalides.', result.error.issues)
    }
  }
  return { data: result.data, error: null }
}

/** Date en ISO — les colonnes `timestamp` remontent des `Date`. */
export function iso(value: Date | string | null): string | null {
  if (value === null) return null
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString()
}
