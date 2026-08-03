import { randomBytes, randomUUID } from 'node:crypto'

/**
 * Identifiants.
 *
 * UUID v4 partout : les identifiants voyagent entre une base SQLite locale, une
 * base PostgreSQL et des fichiers JSON de file d'envoi, sans coordination
 * possible entre les machines. Un compteur ou un identifiant court se
 * collisionnerait dès que deux régies rapportent la même seconde.
 */
export function newId(): string {
  return randomUUID()
}

/**
 * Fabrique un slug d'équipe à partir de son nom.
 *
 * L'admin peut toujours le corriger : ce n'est qu'une proposition de départ,
 * pas une contrainte. Les accents sont décomposés puis retirés, sinon
 * « Citron Élite » produirait un slug avec un caractère refusé par le schéma.
 */
export function slugify(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
}

/**
 * Clé d'API en clair, montrée une seule fois.
 *
 * Préfixée pour être reconnaissable dans un fichier de configuration ou une
 * capture d'écran — un secret identifiable est un secret qu'on pense à
 * révoquer quand il fuite.
 */
export function newApiKey(): string {
  return `citron_${randomBytes(24).toString('base64url')}`
}
