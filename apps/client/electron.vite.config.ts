import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

/**
 * Build du client.
 *
 * `externalizeDepsPlugin` laisse les dépendances Node hors du bundle : ni
 * `better-sqlite3` (binaire natif) ni `ffmpeg-static` (exécutable) ne survivent
 * à une mise en bundle, et `electron-builder` sait les embarquer tels quels.
 *
 * Les paquets du workspace font exception et DOIVENT être bundlés : ils sont
 * publiés en TypeScript source, avec des imports sans extension qu'Electron ne
 * sait pas résoudre à l'exécution. Les externaliser produit un
 * `ERR_MODULE_NOT_FOUND` au démarrage.
 */
const WORKSPACE_PACKAGES = ['@citronhud/contracts', '@citronhud/gsi', '@citronhud/theme']
export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin({ exclude: WORKSPACE_PACKAGES })],
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/main/index.ts') }
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin({ exclude: WORKSPACE_PACKAGES })],
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/preload/index.ts') }
      }
    }
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    resolve: {
      alias: { '@renderer': resolve(__dirname, 'src/renderer/src') }
    },
    plugins: [react()],
    build: {
      rollupOptions: {
        input: {
          // Le panneau de contrôle.
          index: resolve(__dirname, 'src/renderer/index.html'),
          // La fenêtre cachée qui tient le tampon de capture interne : elle a
          // besoin d'un contexte navigateur pour MediaRecorder.
          recorder: resolve(__dirname, 'src/renderer/recorder.html')
        }
      }
    }
  }
})
