#!/usr/bin/env node
/**
 * Génère `src/css/tokens.css` depuis `src/tokens.ts`.
 *
 * Les tokens TS sont la source de vérité ; le CSS en est un artefact. Ce script
 * existe pour qu'une couleur ne puisse pas diverger entre le JS (particules
 * canvas, thème natif Electron) et le CSS (tout le reste).
 *
 * Usage : node scripts/build-tokens.mjs
 */
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { readFileSync } from 'node:fs'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..')

/**
 * Lit tokens.ts sans dépendre d'un runtime TypeScript.
 *
 * Le fichier n'utilise que des littéraux, des `export const` et `as const` :
 * retirer les annotations suffit à en faire du JS valide. Cela évite d'ajouter
 * tsx/esbuild comme dépendance de build à un paquet qui n'en a aucune.
 */
async function loadTokens() {
  const source = readFileSync(resolve(root, 'src/tokens.ts'), 'utf8')
  const js = source
    .replace(/ as const/g, '')
    .replace(/^export type .*$/gm, '')
    .replace(/^\s*\/\*\*[\s\S]*?\*\/\s*$/gm, '')
  const dataUrl = 'data:text/javascript;base64,' + Buffer.from(js).toString('base64')
  return await import(dataUrl)
}

/** Groupe de tokens -> préfixe de la variable CSS. */
const PREFIX = {
  surface: 'surface',
  brand: 'brand',
  ink: 'ink',
  side: 'side',
  semantic: 'sem',
  scrim: 'scrim',
  font: 'font',
  width: 'wdth',
  chamfer: 'chamfer',
  edge: 'edge',
  space: 'space',
  glow: 'glow',
  layer: 'layer'
}

/** Groupes dont les valeurs numériques sont des pixels. */
const PX_GROUPS = new Set(['chamfer', 'edge'])

const kebab = (s) => s.replace(/_/g, '-').replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase()

function emitGroup(name, group) {
  const prefix = PREFIX[name]
  const lines = []
  for (const [key, value] of Object.entries(group)) {
    const varName = `--${prefix}-${kebab(key)}`
    const out = typeof value === 'number' && PX_GROUPS.has(name) ? `${value}px` : value
    lines.push(`  ${varName}: ${out};`)
  }
  return lines
}

function emitTypeScale(name, scale, unitless) {
  const lines = []
  for (const [role, def] of Object.entries(scale)) {
    const base = `--${name}-${kebab(role)}`
    const size = unitless ? `${def.size}px` : def.size
    lines.push(`  ${base}-size: ${size};`)
    lines.push(`  ${base}-weight: ${def.weight};`)
    lines.push(`  ${base}-width: ${def.width};`)
    lines.push(`  ${base}-tracking: ${def.tracking};`)
  }
  return lines
}

const t = await loadTokens()

const out = [
  '/*',
  ' * GÉNÉRÉ — ne pas éditer à la main.',
  ' * Source : packages/theme/src/tokens.ts',
  ' * Régénérer : pnpm --filter @citronhud/theme tokens',
  ' */',
  '',
  ':root {',
  '  /* ---- Surfaces (anatomie du citron, chaudes) ---- */',
  ...emitGroup('surface', t.surface),
  '',
  '  /* ---- Marque : structure uniquement, jamais une équipe ---- */',
  ...emitGroup('brand', t.brand),
  '',
  '  /* ---- Texte ---- */',
  ...emitGroup('ink', t.ink),
  '',
  '  /* ---- Camps (surchargeables par le panneau HUD) ---- */',
  ...emitGroup('side', t.side),
  '',
  '  /* ---- Sémantique de jeu ---- */',
  ...emitGroup('semantic', t.semantic),
  '',
  '  /* ---- Voiles de lisibilité sur vidéo ---- */',
  ...emitGroup('scrim', t.scrim),
  '',
  '  /* ---- Typographie ---- */',
  ...emitGroup('font', t.font),
  ...emitGroup('width', t.width),
  '',
  '  /* ---- Échelle HUD (px de canevas 1920×1080) ---- */',
  ...emitTypeScale('hud', t.hudType, true),
  '',
  '  /* ---- Échelle interface admin ---- */',
  ...emitTypeScale('ui', t.uiType, false),
  '',
  '  /* ---- Chanfrein : la grammaire de forme ---- */',
  ...emitGroup('chamfer', t.chamfer),
  ...emitGroup('edge', t.edge),
  '',
  '  /* ---- Espacement ---- */',
  ...emitGroup('space', t.space),
  '',
  '  /* ---- Mouvement ---- */',
  ...Object.entries(t.motion.duration).map(([k, v]) => `  --dur-${kebab(k)}: ${v};`),
  ...Object.entries(t.motion.ease).map(([k, v]) => `  --ease-${kebab(k)}: ${v};`),
  '',
  '  /* ---- Halos ---- */',
  ...emitGroup('glow', t.glow),
  '',
  '  /* ---- Couches ---- */',
  ...emitGroup('layer', t.layer),
  '}',
  ''
].join('\n')

mkdirSync(resolve(root, 'src/css'), { recursive: true })
writeFileSync(resolve(root, 'src/css/tokens.css'), out, 'utf8')
console.log('✓ src/css/tokens.css généré')
