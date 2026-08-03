/**
 * Configuration d'exécution.
 *
 * Lue paresseusement, jamais au chargement du module : `next build` importe
 * toutes les routes pour les analyser, sur une machine de CI qui n'a ni base ni
 * stockage objet. Valider au chargement ferait échouer la construction d'une
 * image Docker parfaitement saine.
 */

function required(name: string): string {
  const value = process.env[name]
  if (!value) {
    throw new Error(
      `Variable d'environnement ${name} manquante. Voir apps/server/.env.example.`
    )
  }
  return value
}

export function databaseUrl(): string {
  return required('DATABASE_URL')
}

export function authSecret(): string {
  return required('AUTH_SECRET')
}

export function publicUrl(): string {
  return process.env.PUBLIC_URL ?? 'http://localhost:3000'
}

export interface S3Config {
  endpoint: string
  bucket: string
  accessKey: string
  secretKey: string
  /** Préfixe des URL publiques, servi par Caddy et non par l'application. */
  publicUrl: string
}

/**
 * Configuration du stockage objet, ou `null` s'il n'est pas branché.
 *
 * Volontairement facultatif : sans MinIO, tout le reste du serveur fonctionne
 * et seules les routes de téléversement répondent 503. C'est ce qui permet de
 * développer l'admin sans monter la pile complète.
 */
export function s3Config(): S3Config | null {
  const endpoint = process.env.S3_ENDPOINT
  const bucket = process.env.S3_BUCKET
  const accessKey = process.env.S3_ACCESS_KEY
  const secretKey = process.env.S3_SECRET_KEY
  if (!endpoint || !bucket || !accessKey || !secretKey) return null

  return {
    endpoint,
    bucket,
    accessKey,
    secretKey,
    publicUrl: (process.env.S3_PUBLIC_URL ?? `${endpoint}/${bucket}`).replace(/\/$/, '')
  }
}

/** Version du serveur, renvoyée par `/health` et utile au diagnostic. */
export const SERVER_VERSION = '0.1.0'
