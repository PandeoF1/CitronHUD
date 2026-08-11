/**
 * Crée le bucket de test et l'ouvre en lecture anonyme.
 *
 * Écrit avec le SDK S3 déjà présent dans le serveur plutôt qu'avec le client
 * `mc` : le harnais doit tourner à l'identique sur un poste de développement,
 * où MinIO vient du docker-compose, et dans une chaîne d'intégration, où c'est
 * un service du runner. Dépendre d'un binaire externe rendrait l'un des deux
 * impossible.
 *
 * La lecture anonyme reproduit la production : `S3_PUBLIC_URL` est servie telle
 * quelle à l'overlay, qui tourne dans une source navigateur d'OBS et n'a aucun
 * moyen de présenter des identifiants.
 */

import {
  CreateBucketCommand,
  PutBucketPolicyCommand,
  S3Client
} from '@aws-sdk/client-s3'

const endpoint = process.env.S3_ENDPOINT
const bucket = process.env.S3_BUCKET
const accessKeyId = process.env.S3_ACCESS_KEY
const secretAccessKey = process.env.S3_SECRET_KEY

if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) {
  console.error('Configuration S3 incomplète : S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY, S3_SECRET_KEY.')
  process.exit(1)
}

const client = new S3Client({
  endpoint,
  region: 'us-east-1',
  credentials: { accessKeyId, secretAccessKey },
  // MinIO ne sert pas les buckets en sous-domaine.
  forcePathStyle: true
})

try {
  await client.send(new CreateBucketCommand({ Bucket: bucket }))
  console.log(`Bucket ${bucket} créé.`)
} catch (error) {
  const code = error?.name ?? ''
  if (code === 'BucketAlreadyOwnedByYou' || code === 'BucketAlreadyExists') {
    console.log(`Bucket ${bucket} déjà présent.`)
  } else {
    console.error(`Création du bucket impossible : ${error?.message ?? error}`)
    process.exit(1)
  }
}

await client.send(
  new PutBucketPolicyCommand({
    Bucket: bucket,
    Policy: JSON.stringify({
      Version: '2012-10-17',
      Statement: [
        {
          Effect: 'Allow',
          Principal: { AWS: ['*'] },
          Action: ['s3:GetObject'],
          Resource: [`arn:aws:s3:::${bucket}/*`]
        }
      ]
    })
  })
)
console.log('Lecture anonyme activée.')
