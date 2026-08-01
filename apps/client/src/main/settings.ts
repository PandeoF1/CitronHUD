import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import {
  clientSettingsSchema,
  defaultClientSettings,
  hudConfigSchema,
  defaultHudConfig,
  type ClientSettings,
  type HudConfig
} from '@citronhud/contracts'
import { settingsPath } from './paths'

/**
 * Réglages persistés.
 *
 * Stockés en JSON lisible plutôt qu'en base : quand un streamer a un problème
 * en direct, lui faire ouvrir un fichier et lire une ligne est infiniment plus
 * rapide que d'inspecter une table SQLite.
 *
 * Toute lecture passe par le schéma Zod. Un fichier corrompu ou écrit par une
 * version antérieure retombe donc sur les valeurs par défaut au lieu de faire
 * planter le démarrage — un client qui ne s'ouvre plus juste avant un live est
 * le pire scénario possible.
 */

interface PersistedFile {
  client: ClientSettings
  hud: HudConfig
}

const FALLBACK: PersistedFile = { client: defaultClientSettings, hud: defaultHudConfig }

let cache: PersistedFile | null = null

function load(): PersistedFile {
  const path = settingsPath()
  if (!existsSync(path)) return { ...FALLBACK }

  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>
    return {
      client: clientSettingsSchema.parse(raw.client ?? {}),
      hud: hudConfigSchema.parse(raw.hud ?? {})
    }
  } catch (error) {
    console.error('[settings] Fichier illisible, retour aux valeurs par défaut :', error)
    return { ...FALLBACK }
  }
}

function persist(value: PersistedFile): void {
  try {
    writeFileSync(settingsPath(), JSON.stringify(value, null, 2), 'utf8')
  } catch (error) {
    console.error('[settings] Écriture impossible :', error)
  }
}

export function getClientSettings(): ClientSettings {
  cache ??= load()
  return cache.client
}

export function getHudConfig(): HudConfig {
  cache ??= load()
  return cache.hud
}

/** Applique une modification partielle et renvoie l'état complet résultant. */
export function updateClientSettings(patch: Partial<ClientSettings>): ClientSettings {
  cache ??= load()
  cache.client = clientSettingsSchema.parse({ ...cache.client, ...patch })
  persist(cache)
  return cache.client
}

export function updateHudConfig(patch: Partial<HudConfig>): HudConfig {
  cache ??= load()
  cache.hud = hudConfigSchema.parse({ ...cache.hud, ...patch })
  persist(cache)
  return cache.hud
}
