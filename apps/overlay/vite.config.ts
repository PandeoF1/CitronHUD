import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import pkg from './package.json' with { type: 'json' }

/**
 * L'overlay est servi par le client local à OBS, jamais depuis la racine d'un
 * domaine. `base: './'` produit des chemins relatifs pour que le bundle
 * fonctionne quel que soit le préfixe d'URL choisi.
 */
export default defineConfig({
  base: './',
  plugins: [react()],
  define: {
    /*
     * La version est figée dans le bundle : le client la compare au manifeste
     * du serveur pour décider s'il doit récupérer un overlay plus récent.
     */
    __OVERLAY_VERSION__: JSON.stringify(pkg.version)
  },
  build: {
    outDir: 'dist',
    // Une source navigateur charge tout d'un coup : le découpage en chunks
    // n'apporte rien et multiplie les requêtes au démarrage.
    cssCodeSplit: false,
    rollupOptions: {
      output: {
        manualChunks: undefined
      }
    }
  },
  server: {
    port: 5180,
    strictPort: true
  }
})
