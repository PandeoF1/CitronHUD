import type { NextConfig } from 'next'

/**
 * Configuration Next.js.
 *
 * `transpilePackages` est indispensable : les paquets de l'atelier sont
 * consommés en TypeScript source, sans étape de compilation propre. Next doit
 * donc les traverser lui-même, sinon `import '@citronhud/contracts'` échoue au
 * build avec une erreur de syntaxe sur le premier type rencontré.
 */
const nextConfig: NextConfig = {
  transpilePackages: ['@citronhud/contracts', '@citronhud/theme'],
  /*
   * Les avatars et logos sont servis par MinIO derrière Caddy, dont le domaine
   * n'est connu qu'au déploiement. On désactive l'optimiseur d'images plutôt que
   * de maintenir une liste blanche : ces images sont déjà redimensionnées à
   * l'envoi, et l'admin n'a pas le trafic qui justifierait un cache d'images.
   */
  images: { unoptimized: true },
  experimental: {
    serverActions: {
      // Un logo d'équipe passe par une action serveur ; la limite par défaut de
      // 1 Mo refuse un PNG d'organisation à peine détouré.
      bodySizeLimit: '8mb'
    }
  }
}

export default nextConfig
