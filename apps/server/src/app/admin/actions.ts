'use server'

import { and, eq, ne } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import {
  createPlayerSchema,
  createTeamSchema,
  updatePlayerSchema,
  updateTeamSchema
} from '@citronhud/contracts'
import { getDb } from '../../db'
import { apiKeys, highlights, players, records, teams } from '../../db/schema'
import { hashApiKey } from '../../lib/api-key'
import { currentUser } from '../../lib/auth'
import { newApiKey, newId, slugify } from '../../lib/ids'
import type { ActionState } from './action-state'

/**
 * Actions serveur de l'administration.
 *
 * Chacune revérifie la session : une action serveur est un point d'entrée HTTP
 * à part entière, atteignable directement, et la garde du layout ne la protège
 * pas. C'est l'erreur classique du modèle — la page est bien fermée, l'action
 * qu'elle contient reste grande ouverte.
 */

async function guard(): Promise<void> {
  if (!(await currentUser())) redirect('/login')
}

/** Champ texte, avec le vide traité comme « non renseigné ». */
function text(form: FormData, key: string): string | null {
  const value = form.get(key)
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

const failure = (message: string): ActionState => ({ ok: false, message })

/* ---------------------------------------------------------------------------
 * Équipes
 * ------------------------------------------------------------------------- */

export async function createTeam(_state: ActionState, form: FormData): Promise<ActionState> {
  await guard()
  const user = await currentUser()

  const name = text(form, 'name') ?? ''
  const parsed = createTeamSchema.safeParse({
    slug: slugify(text(form, 'slug') ?? name),
    name,
    shortName: text(form, 'shortName') ?? '',
    country: text(form, 'country')?.toUpperCase() ?? null,
    logoUrl: text(form, 'logoUrl'),
    color: text(form, 'color')
  })
  if (!parsed.success) return failure(parsed.error.issues[0]?.message ?? 'Saisie invalide.')

  const clash = await getDb()
    .select({ id: teams.id })
    .from(teams)
    .where(eq(teams.slug, parsed.data.slug))
  if (clash.length > 0) return failure(`Le slug « ${parsed.data.slug} » est déjà pris.`)

  await getDb()
    .insert(teams)
    .values({ id: newId(), ...parsed.data, createdBy: user?.id ?? null })

  revalidatePath('/admin/teams')
  revalidatePath('/admin')
  return { ok: true, message: `Équipe « ${parsed.data.name} » créée.` }
}

export async function updateTeam(_state: ActionState, form: FormData): Promise<ActionState> {
  await guard()

  const id = text(form, 'id')
  if (!id) return failure('Équipe non identifiée.')

  /*
   * Le formulaire d'édition soumet tous les champs, donc les valeurs par défaut
   * de `.partial()` ne peuvent rien effacer ici — contrairement au PATCH de
   * l'API, où seuls les champs envoyés doivent compter (voir `parsePatch`).
   * Seul le slug est repris de l'existant s'il est vidé : il ne peut pas être
   * nul, et le laisser vide n'exprime pas « supprime-le » mais « n'y touche pas ».
   */
  const slug = text(form, 'slug')
  const parsed = updateTeamSchema.safeParse({
    ...(slug ? { slug: slugify(slug) } : {}),
    name: text(form, 'name') ?? '',
    shortName: text(form, 'shortName') ?? '',
    country: text(form, 'country')?.toUpperCase() ?? null,
    logoUrl: text(form, 'logoUrl'),
    color: text(form, 'color')
  })
  if (!parsed.success) return failure(parsed.error.issues[0]?.message ?? 'Saisie invalide.')

  if (parsed.data.slug) {
    const clash = await getDb()
      .select({ id: teams.id })
      .from(teams)
      .where(and(eq(teams.slug, parsed.data.slug), ne(teams.id, id)))
    if (clash.length > 0) return failure(`Le slug « ${parsed.data.slug} » est déjà pris.`)
  }

  await getDb().update(teams).set(parsed.data).where(eq(teams.id, id))

  revalidatePath('/admin/teams')
  revalidatePath(`/admin/teams/${id}`)
  return { ok: true, message: 'Équipe enregistrée.' }
}

export async function deleteTeam(form: FormData): Promise<void> {
  await guard()
  const id = text(form, 'id')
  if (!id) return

  await getDb().delete(teams).where(eq(teams.id, id))
  revalidatePath('/admin/teams')
  redirect('/admin/teams')
}

/* ---------------------------------------------------------------------------
 * Joueurs
 * ------------------------------------------------------------------------- */

function playerFields(form: FormData) {
  return {
    steamId: text(form, 'steamId') ?? '',
    nickname: text(form, 'nickname') ?? '',
    firstName: text(form, 'firstName'),
    lastName: text(form, 'lastName'),
    country: text(form, 'country')?.toUpperCase() ?? null,
    avatarUrl: text(form, 'avatarUrl'),
    teamId: text(form, 'teamId'),
    role: text(form, 'role'),
    isCoach: form.get('isCoach') === 'on',
    socials: {
      twitch: text(form, 'twitch'),
      x: text(form, 'x'),
      instagram: text(form, 'instagram')
    }
  }
}

export async function createPlayer(_state: ActionState, form: FormData): Promise<ActionState> {
  await guard()

  const parsed = createPlayerSchema.safeParse(playerFields(form))
  if (!parsed.success) return failure(parsed.error.issues[0]?.message ?? 'Saisie invalide.')

  const clash = await getDb()
    .select({ id: players.id })
    .from(players)
    .where(eq(players.steamId, parsed.data.steamId))
  if (clash.length > 0) return failure('Ce SteamID est déjà attribué à un joueur.')

  await getDb()
    .insert(players)
    .values({ id: newId(), ...parsed.data })

  revalidatePath('/admin/players')
  revalidatePath('/admin')
  return { ok: true, message: `Joueur « ${parsed.data.nickname} » créé.` }
}

export async function updatePlayer(_state: ActionState, form: FormData): Promise<ActionState> {
  await guard()

  const id = text(form, 'id')
  if (!id) return failure('Joueur non identifié.')

  const parsed = updatePlayerSchema.safeParse(playerFields(form))
  if (!parsed.success) return failure(parsed.error.issues[0]?.message ?? 'Saisie invalide.')

  if (parsed.data.steamId) {
    const clash = await getDb()
      .select({ id: players.id })
      .from(players)
      .where(and(eq(players.steamId, parsed.data.steamId), ne(players.id, id)))
    if (clash.length > 0) return failure('Ce SteamID est déjà attribué à un joueur.')
  }

  await getDb().update(players).set(parsed.data).where(eq(players.id, id))

  revalidatePath('/admin/players')
  revalidatePath(`/admin/players/${id}`)
  return { ok: true, message: 'Joueur enregistré.' }
}

export async function deletePlayer(form: FormData): Promise<void> {
  await guard()
  const id = text(form, 'id')
  if (!id) return

  await getDb().delete(players).where(eq(players.id, id))
  revalidatePath('/admin/players')
  redirect('/admin/players')
}

/* ---------------------------------------------------------------------------
 * Clés d'API
 * ------------------------------------------------------------------------- */

/**
 * Émet une clé.
 *
 * La valeur en clair ne revient qu'ici, dans l'état de l'action : seul son
 * haché est stocké, donc personne — pas même l'administrateur qui vient de la
 * créer — ne pourra la relire ensuite. Perdue, elle se remplace ; elle ne se
 * retrouve pas.
 */
export async function createApiKey(_state: ActionState, form: FormData): Promise<ActionState> {
  await guard()
  const user = await currentUser()

  const label = text(form, 'label')
  if (!label) return failure('Donnez un nom à la clé (par exemple « Régie principale »).')

  const key = newApiKey()
  await getDb()
    .insert(apiKeys)
    .values({
      id: newId(),
      label,
      hash: hashApiKey(key),
      prefix: key.slice(0, 14),
      createdBy: user?.id ?? null
    })

  revalidatePath('/admin/keys')
  return { ok: true, message: `Clé « ${label} » créée.`, secret: key }
}

/**
 * Révocation.
 *
 * On marque, on ne supprime pas : la ligne reste pour que l'admin sache qu'une
 * clé a existé et quand elle a servi pour la dernière fois. Supprimer effacerait
 * cette trace au moment précis où elle devient intéressante.
 */
export async function revokeApiKey(form: FormData): Promise<void> {
  await guard()
  const id = text(form, 'id')
  if (!id) return

  await getDb().update(apiKeys).set({ revokedAt: new Date() }).where(eq(apiKeys.id, id))
  revalidatePath('/admin/keys')
}

/* ---------------------------------------------------------------------------
 * Historique
 * ------------------------------------------------------------------------- */

export async function deleteHighlight(form: FormData): Promise<void> {
  await guard()
  const id = text(form, 'id')
  if (!id) return

  await getDb().delete(highlights).where(eq(highlights.id, id))
  revalidatePath('/admin/highlights')
}

export async function deleteRecord(form: FormData): Promise<void> {
  await guard()
  const id = text(form, 'id')
  if (!id) return

  await getDb().delete(records).where(eq(records.id, id))
  revalidatePath('/admin/records')
}
