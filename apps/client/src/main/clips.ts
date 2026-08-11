import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { existsSync, statSync, readdirSync, unlinkSync, copyFileSync } from 'node:fs'
import { join, basename, extname } from 'node:path'
import ffmpegPath from 'ffmpeg-static'
import { CAPTURE_WINDOW, type Highlight } from '@citronhud/contracts'
import { captureDir, clipsDir } from './paths'

const run = promisify(execFile)

/**
 * Préparation des clips de replay.
 *
 * Le tampon d'OBS enregistre 45 secondes ; un ace en dure 8. Diffuser le
 * tampon entier ferait manquer la manche suivante aux spectateurs, donc on
 * découpe autour du temps fort.
 *
 * La découpe se fait par copie de flux (`-c copy`) quand c'est possible :
 * réencoder un clip de 1080p60 prend plusieurs secondes de CPU au pire moment,
 * juste après une action, alors que la machine encode déjà le direct.
 */

export interface PreparedClip {
  path: string
  /** URL servie par le serveur local à l'overlay. */
  url: string
  durationMs: number
}

function ffmpeg(): string | null {
  // `ffmpeg-static` expose un chemin qui pointe dans asar une fois empaqueté ;
  // electron-builder le déballe via asarUnpack, d'où la correction ici.
  const raw = ffmpegPath as unknown as string | null
  if (!raw) return null
  const unpacked = raw.replace('app.asar', 'app.asar.unpacked')
  return existsSync(unpacked) ? unpacked : existsSync(raw) ? raw : null
}

/** Durée d'un fichier, en secondes. */
async function probeDuration(path: string): Promise<number | null> {
  const bin = ffmpeg()
  if (!bin) return null
  try {
    // ffmpeg écrit les métadonnées sur stderr et sort en code 1 sans sortie :
    // c'est le comportement attendu, on lit donc stderr plutôt que le code.
    await run(bin, ['-i', path, '-f', 'null', '-'])
    return null
  } catch (error) {
    const stderr = (error as { stderr?: string }).stderr ?? ''
    const match = stderr.match(/Duration:\s*(\d+):(\d+):(\d+\.\d+)/)
    if (!match) return null
    return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3])
  }
}

/**
 * Conteneurs que la source navigateur sait décoder.
 *
 * Le tampon de replay d'OBS suit le format d'enregistrement du profil, que le
 * streamer a pu régler sur `mkv` — c'est même longtemps resté le défaut, parce
 * qu'un mkv survit à un plantage d'OBS là où un mp4 reste illisible. Or
 * Chromium ne lit pas le mkv : servi tel quel à l'overlay, il donne un
 * rectangle noir à l'antenne, sans la moindre erreur.
 *
 * On ne touche donc pas aux réglages d'OBS — ils appartiennent au streamer et
 * protègent ses enregistrements — on remuxe de notre côté.
 */
const BROWSER_PLAYABLE = new Set(['.mp4', '.webm'])

/**
 * Découpe le clip autour du temps fort.
 *
 * On prend la fin du fichier : le tampon est sauvegardé juste après l'action,
 * donc le moment intéressant est toujours à la fin, jamais au début.
 *
 * La découpe et le remuxage se font tous deux par copie de flux : aucune image
 * n'est réencodée, seul le conteneur change.
 */
export async function prepareClip(
  sourcePath: string,
  highlight: Highlight,
  trim: boolean
): Promise<PreparedClip | null> {
  if (!existsSync(sourcePath)) return null

  const window = CAPTURE_WINDOW[highlight.kind]
  const wantedMs = window.preRollMs + window.postRollMs
  const target = join(clipsDir(), `${highlight.id}.mp4`)
  const bin = ffmpeg()
  const extension = extname(sourcePath).toLowerCase()
  const playable = BROWSER_PLAYABLE.has(extension)

  /*
   * Le fichier source n'est jamais dans le dossier servi : le tampon d'OBS
   * écrit dans le dossier d'enregistrement du streamer, la capture interne dans
   * `captureDir`. Servir son chemin tel quel donnerait une URL en 404. On le
   * recopie donc dans `clipsDir`, seul dossier exposé en HTTP et seul dossier
   * que la purge sait borner.
   */
  const adoptAsIs = (): PreparedClip | null => {
    const copy = join(clipsDir(), `${highlight.id}${extension}`)
    try {
      copyFileSync(sourcePath, copy)
      return { path: copy, url: `/clips/${basename(copy)}`, durationMs: wantedMs }
    } catch (error) {
      console.error('[clips] Copie impossible :', error)
      return null
    }
  }

  /*
   * Sans ffmpeg on ne peut ni découper ni remuxer. Un replay trop long reste
   * préférable à pas de replay — mais seulement s'il est lisible ; sinon mieux
   * vaut renoncer franchement que diffuser un cadre noir.
   */
  if (!bin) return playable ? adoptAsIs() : null

  const args = ['-y']
  if (trim) {
    const total = await probeDuration(sourcePath)
    const start = total !== null ? Math.max(0, total - wantedMs / 1000) : 0
    // `-ss` avant `-i` fait chercher par index plutôt que décoder depuis le
    // début : quasi instantané sur un fichier de 45 s.
    args.push('-ss', start.toFixed(2))
    args.push('-i', sourcePath, '-t', (wantedMs / 1000).toFixed(2))
  } else {
    if (playable) return adoptAsIs()
    args.push('-i', sourcePath)
  }
  args.push('-c', 'copy', '-movflags', '+faststart', target)

  try {
    await run(bin, args)
    discardTemporarySource(sourcePath)
    return { path: target, url: `/clips/${basename(target)}`, durationMs: wantedMs }
  } catch (error) {
    console.error('[clips] Conversion impossible :', error)
    return playable ? adoptAsIs() : null
  }
}

/**
 * Efface la capture brute une fois le clip produit.
 *
 * Uniquement la nôtre : `captureDir` est un tampon de travail, et sans ce
 * nettoyage il accumule un `.webm` de plusieurs dizaines de mégaoctets par
 * temps fort, que rien ne purge jamais. Le fichier écrit par OBS, lui, reste
 * intact — il appartient au streamer, qui l'a peut-être réglé pour archiver.
 */
function discardTemporarySource(sourcePath: string): void {
  if (!sourcePath.startsWith(captureDir())) return
  try {
    unlinkSync(sourcePath)
  } catch {
    // Fichier déjà parti ou verrouillé : sans conséquence, la purge repassera.
  }
}

/**
 * Purge les clips les plus anciens.
 *
 * Un match produit facilement quinze clips de 1080p ; sans purge, le dossier
 * atteint plusieurs gigaoctets en une saison sans que personne ne le remarque.
 */
export function pruneClips(keep: number): void {
  const dir = clipsDir()
  try {
    const files = readdirSync(dir)
      .filter((name) => ['.mp4', '.mkv', '.webm'].includes(extname(name)))
      .map((name) => {
        const path = join(dir, name)
        return { path, mtime: statSync(path).mtimeMs }
      })
      .sort((a, b) => b.mtime - a.mtime)

    for (const file of files.slice(keep)) unlinkSync(file.path)
  } catch (error) {
    console.error('[clips] Purge impossible :', error)
  }
}
