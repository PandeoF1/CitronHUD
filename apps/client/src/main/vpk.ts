import { closeSync, openSync, readFileSync, readSync } from 'node:fs'

/**
 * Lecteur d'archives VPK (Source 2).
 *
 * Juste ce qu'il faut pour retrouver et sortir quelques fichiers : l'index vit
 * dans `pak01_dir.vpk`, les octets dans `pak01_NNN.vpk`. On ne décompresse
 * rien ici — le VPK ne compresse pas, il concatène.
 */

export interface VpkEntry {
  path: string
  archiveIndex: number
  entryOffset: number
  entryLength: number
  preloadOffset: number
  preloadBytes: number
}

const VPK_SIGNATURE = 0x55aa1234

/**
 * Lit l'arborescence d'un `_dir.vpk`.
 *
 * L'index est un triple imbriqué extension → dossier → fichier, chaque niveau
 * clos par une chaîne vide. Le nom complet se reconstitue en sens inverse.
 */
export function readVpkIndex(dirPath: string): { buffer: Buffer; entries: Map<string, VpkEntry> } {
  const buffer = readFileSync(dirPath)
  let offset = 0

  const u32 = (): number => {
    const value = buffer.readUInt32LE(offset)
    offset += 4
    return value
  }
  const u16 = (): number => {
    const value = buffer.readUInt16LE(offset)
    offset += 2
    return value
  }
  const str = (): string => {
    const start = offset
    while (buffer[offset] !== 0) offset++
    const value = buffer.toString('utf8', start, offset)
    offset++
    return value
  }

  if (u32() !== VPK_SIGNATURE) throw new Error(`${dirPath} : signature VPK absente`)
  const version = u32()
  u32() // treeSize
  if (version === 2) {
    u32() // fileDataSectionSize
    u32() // archiveMD5SectionSize
    u32() // otherMD5SectionSize
    u32() // signatureSectionSize
  }

  const entries = new Map<string, VpkEntry>()
  for (;;) {
    const extension = str()
    if (!extension) break
    for (;;) {
      const directory = str()
      if (!directory) break
      for (;;) {
        const name = str()
        if (!name) break
        u32() // crc
        const preloadBytes = u16()
        const archiveIndex = u16()
        const entryOffset = u32()
        const entryLength = u32()
        u16() // terminateur 0xFFFF
        const preloadOffset = offset
        offset += preloadBytes
        const path = `${directory}/${name}.${extension}`
        entries.set(path, {
          path,
          archiveIndex,
          entryOffset,
          entryLength,
          preloadOffset,
          preloadBytes
        })
      }
    }
  }

  return { buffer, entries }
}

/**
 * Sort les octets d'une entrée.
 *
 * Un fichier peut être entièrement en préchargement dans l'index, entièrement
 * dans une archive, ou à cheval sur les deux — d'où la concaténation.
 */
export function readVpkEntry(dirPath: string, buffer: Buffer, entry: VpkEntry): Buffer {
  const parts: Buffer[] = []
  if (entry.preloadBytes > 0) {
    parts.push(buffer.subarray(entry.preloadOffset, entry.preloadOffset + entry.preloadBytes))
  }

  if (entry.entryLength > 0) {
    const archive = dirPath.replace(
      /_dir\.vpk$/,
      `_${String(entry.archiveIndex).padStart(3, '0')}.vpk`
    )
    const chunk = Buffer.alloc(entry.entryLength)
    const handle = openSync(archive, 'r')
    try {
      readSync(handle, chunk, 0, entry.entryLength, entry.entryOffset)
    } finally {
      closeSync(handle)
    }
    parts.push(chunk)
  }

  return parts.length === 1 ? parts[0]! : Buffer.concat(parts)
}
