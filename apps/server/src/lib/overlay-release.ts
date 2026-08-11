import { createHash } from 'node:crypto'
import AdmZip from 'adm-zip'
import { eq } from 'drizzle-orm'
import { getDb } from '../db'
import { overlayReleases } from '../db/schema'
import { newId } from './ids'
import { putObject, storageAvailable } from './s3'

/**
 * Publication d'une version d'overlay.
 *
 * Isolé de l'action serveur pour deux raisons. La première est pratique : une
 * action serveur ne s'appelle qu'à travers le protocole de React, donc ni
 * depuis un script de CI, ni depuis un test de bout en bout. La seconde est
 * qu'un bundle sera plus souvent publié par une chaîne d'intégration que par
 * quelqu'un devant un formulaire.
 */

/**
 * 12 Mo : un bundle d'overlay pèse quelques centaines de kilooctets. La limite
 * reste sous celle des actions serveur de `next.config.ts`, pour que le refus
 * vienne d'ici avec un message utile plutôt que de Next avec une erreur brute.
 */
export const MAX_BUNDLE_BYTES = 12 * 1024 * 1024

export type PublishOutcome =
  | { ok: true; version: string }
  | { ok: false; code: PublishErrorCode; message: string }

export type PublishErrorCode =
  | 'no_storage'
  | 'too_large'
  | 'not_a_zip'
  | 'missing_index'
  | 'duplicate_version'
  | 'storage_refused'

export interface PublishInput {
  version: string
  bundle: Buffer
  minClientVersion?: string
  notes?: string
}

/**
 * Vérifie puis enregistre un bundle.
 *
 * L'archive est inspectée avant d'être écrite, et pas seulement signée : le
 * client contrôle bien le SHA-256 avant d'extraire, mais une empreinte ne prouve
 * que l'intégrité, jamais la pertinence. Publier le mauvais zip éteindrait le
 * HUD de toutes les régies au prochain sondage, automatiquement et sans erreur
 * visible nulle part.
 */
export async function publishRelease(input: PublishInput): Promise<PublishOutcome> {
  if (!storageAvailable()) {
    return {
      ok: false,
      code: 'no_storage',
      message: "Aucun stockage objet configuré : impossible d'héberger le bundle."
    }
  }

  if (input.bundle.byteLength > MAX_BUNDLE_BYTES) {
    return { ok: false, code: 'too_large', message: 'Archive trop volumineuse (12 Mo maximum).' }
  }

  try {
    const entries = new AdmZip(input.bundle).getEntries().map((entry) => entry.entryName)
    if (!entries.includes('index.html')) {
      return {
        ok: false,
        code: 'missing_index',
        message: "L'archive ne contient pas d'index.html à sa racine."
      }
    }
  } catch {
    return { ok: false, code: 'not_a_zip', message: "Archive illisible : ce n'est pas un zip valide." }
  }

  const existing = await getDb()
    .select({ id: overlayReleases.id })
    .from(overlayReleases)
    .where(eq(overlayReleases.version, input.version))
  if (existing.length > 0) {
    return {
      ok: false,
      code: 'duplicate_version',
      message: `La version ${input.version} est déjà publiée.`
    }
  }

  const url = await putObject(`overlay/${input.version}.zip`, input.bundle, 'application/zip')
  if (!url) {
    return { ok: false, code: 'storage_refused', message: "Le stockage objet a refusé l'archive." }
  }

  const sha256 = createHash('sha256').update(input.bundle).digest('hex')

  /*
   * Une seule version courante à la fois : la bascule et l'insertion doivent
   * être atomiques, sinon un client qui sonde entre les deux écritures reçoit
   * un 404 et garde son bundle — ou en voit passer deux.
   */
  await getDb().transaction(async (tx) => {
    await tx.update(overlayReleases).set({ isCurrent: false })
    await tx.insert(overlayReleases).values({
      id: newId(),
      version: input.version,
      url,
      sha256,
      sizeBytes: input.bundle.byteLength,
      minClientVersion: input.minClientVersion ?? '0.0.0',
      notes: input.notes ?? '',
      isCurrent: true,
      releasedAt: new Date()
    })
  })

  return { ok: true, version: input.version }
}

/**
 * Rétablit une version antérieure.
 *
 * Contrepartie de la mise à jour automatique : puisqu'un bundle se propage seul
 * à toutes les régies, il faut pouvoir revenir en arrière aussi vite, sans rien
 * reconstruire ni redéployer.
 */
export async function makeCurrent(id: string): Promise<void> {
  await getDb().transaction(async (tx) => {
    await tx.update(overlayReleases).set({ isCurrent: false })
    await tx.update(overlayReleases).set({ isCurrent: true }).where(eq(overlayReleases.id, id))
  })
}
