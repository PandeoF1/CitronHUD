import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { s3Config, type S3Config } from './env'

/**
 * Stockage objet — avatars, logos et clips de replay.
 *
 * Les gros fichiers ne traversent jamais le processus Next.js : le serveur
 * signe une URL et le client téléverse directement vers MinIO. Un clip de
 * 40 Mo qui passerait par l'application y occuperait un worker pendant toute la
 * montée, et trois régies qui téléversent ensemble suffiraient à rendre l'admin
 * inutilisable.
 */

let client: S3Client | null = null

function getClient(config: S3Config): S3Client {
  client ??= new S3Client({
    endpoint: config.endpoint,
    region: 'us-east-1',
    credentials: { accessKeyId: config.accessKey, secretAccessKey: config.secretKey },
    // MinIO ne sert pas les buckets en sous-domaine : sans ce réglage, le SDK
    // adresse `http://citronhud.minio:9000` et la requête n'arrive nulle part.
    forcePathStyle: true
  })
  return client
}

/** Durée de validité d'une URL signée. */
const TICKET_TTL_SECONDS = 900

export interface UploadTicket {
  uploadUrl: string
  headers: Record<string, string>
  publicUrl: string
  expiresAt: string
}

export function storageAvailable(): boolean {
  return s3Config() !== null
}

/**
 * Prépare un téléversement direct.
 *
 * `key` est imposée par le serveur — jamais par le client — pour qu'un appelant
 * ne puisse pas écrire par-dessus l'avatar d'un autre joueur ni sortir du
 * préfixe qui lui est réservé.
 */
export async function presignUpload(
  key: string,
  contentType: string,
  sizeBytes?: number
): Promise<UploadTicket | null> {
  const config = s3Config()
  if (!config) return null

  const command = new PutObjectCommand({
    Bucket: config.bucket,
    Key: key,
    ContentType: contentType,
    ...(sizeBytes ? { ContentLength: sizeBytes } : {})
  })

  const uploadUrl = await getSignedUrl(getClient(config), command, {
    expiresIn: TICKET_TTL_SECONDS
  })

  return {
    uploadUrl,
    // Rejoués tels quels par le client : la signature couvre le type de contenu,
    // donc un PUT qui l'omet ou le change est rejeté par le stockage.
    headers: { 'content-type': contentType },
    publicUrl: `${config.publicUrl}/${key}`,
    expiresAt: new Date(Date.now() + TICKET_TTL_SECONDS * 1000).toISOString()
  }
}

/**
 * Téléverse depuis le serveur.
 *
 * Réservé aux petits fichiers arrivés par action serveur — un logo déposé dans
 * l'admin. Les clips passent toujours par `presignUpload`.
 */
export async function putObject(
  key: string,
  body: Buffer,
  contentType: string
): Promise<string | null> {
  const config = s3Config()
  if (!config) return null

  await getClient(config).send(
    new PutObjectCommand({
      Bucket: config.bucket,
      Key: key,
      Body: body,
      ContentType: contentType
    })
  )
  return `${config.publicUrl}/${key}`
}
