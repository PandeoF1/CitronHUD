import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { existsSync, statSync, readdirSync, unlinkSync } from 'node:fs'
import { join, basename, extname } from 'node:path'
import ffmpegPath from 'ffmpeg-static'
import { CAPTURE_WINDOW, type Highlight } from '@citronhud/contracts'
import { clipsDir } from './paths'

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
 * Découpe le clip autour du temps fort.
 *
 * On prend la fin du fichier : le tampon est sauvegardé juste après l'action,
 * donc le moment intéressant est toujours à la fin, jamais au début.
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

  if (!trim || !bin) {
    // Sans ffmpeg, on sert le fichier brut : un replay trop long reste très
    // préférable à pas de replay du tout.
    return { path: sourcePath, url: `/clips/${basename(sourcePath)}`, durationMs: wantedMs }
  }

  const total = await probeDuration(sourcePath)
  const start = total !== null ? Math.max(0, total - wantedMs / 1000) : 0

  try {
    await run(bin, [
      '-y',
      // `-ss` avant `-i` fait chercher par index plutôt que décoder depuis le
      // début : quasi instantané sur un fichier de 45 s.
      '-ss',
      start.toFixed(2),
      '-i',
      sourcePath,
      '-t',
      (wantedMs / 1000).toFixed(2),
      '-c',
      'copy',
      '-movflags',
      '+faststart',
      target
    ])
    return { path: target, url: `/clips/${basename(target)}`, durationMs: wantedMs }
  } catch (error) {
    console.error('[clips] Découpe impossible, diffusion du fichier brut :', error)
    return { path: sourcePath, url: `/clips/${basename(sourcePath)}`, durationMs: wantedMs }
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
