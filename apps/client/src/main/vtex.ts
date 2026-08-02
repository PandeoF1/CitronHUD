import { deflateSync } from 'node:zlib'

/**
 * Décodeur de textures compilées Source 2 (`.vtex_c`) vers PNG.
 *
 * Volontairement partiel. Sur CS2, TOUTES les cartes de la pool compétitive
 * sortent en BGRA8888 1024×1024, un seul niveau de mip, compressé LZ4 — c'est
 * le seul chemin qui compte. DXT1 et DXT5 sont gérés en plus parce qu'ils
 * couvrent les cartes otages et l'aperçu d'atelier pour une centaine de lignes.
 * Tout le reste (BC7, formats flottants) est refusé explicitement plutôt que
 * décodé de travers : une image fausse serait pire qu'une image absente.
 */

const enum Format {
  DXT1 = 1,
  DXT5 = 2,
  RGBA8888 = 4,
  BGRA8888 = 28
}

const FORMAT_NAMES: Record<number, string> = {
  1: 'DXT1',
  2: 'DXT5',
  4: 'RGBA8888',
  19: 'BC6H',
  20: 'BC7',
  28: 'BGRA8888'
}

export interface DecodedTexture {
  width: number
  height: number
  /** Pixels RGBA non prémultipliés. */
  rgba: Buffer
}

/* --------------------------------------------------------------------------
 * LZ4
 * -------------------------------------------------------------------------- */

/**
 * Décompresse un bloc LZ4 brut.
 *
 * Format « block », sans en-tête de conteneur : Source 2 stocke la taille
 * compressée à part. La recopie des correspondances se fait octet par octet et
 * NON par `copy` : LZ4 autorise le chevauchement (un décalage de 1 encode la
 * répétition d'un octet), qu'une copie de plage écraserait.
 */
export function lz4DecodeBlock(source: Buffer, expectedLength: number): Buffer {
  const out = Buffer.alloc(expectedLength)
  let s = 0
  let d = 0

  while (s < source.length) {
    const token = source[s++]!

    let literals = token >> 4
    if (literals === 15) {
      let extra: number
      do {
        extra = source[s++]!
        literals += extra
      } while (extra === 255)
    }

    if (literals > 0) {
      source.copy(out, d, s, s + literals)
      s += literals
      d += literals
    }
    if (s >= source.length) break

    const matchOffset = source[s]! | (source[s + 1]! << 8)
    s += 2
    if (matchOffset === 0) throw new Error('LZ4 : décalage nul')

    let matchLength = token & 0x0f
    if (matchLength === 15) {
      let extra: number
      do {
        extra = source[s++]!
        matchLength += extra
      } while (extra === 255)
    }
    matchLength += 4

    let from = d - matchOffset
    for (let i = 0; i < matchLength; i++) out[d++] = out[from++]!
  }

  if (d !== expectedLength) {
    throw new Error(`LZ4 : ${d} octets produits pour ${expectedLength} attendus`)
  }
  return out
}

/* --------------------------------------------------------------------------
 * Blocs compressés DXT
 * -------------------------------------------------------------------------- */

function rgb565(value: number): [number, number, number] {
  return [
    ((value >> 11) & 0x1f) * 255 / 31,
    ((value >> 5) & 0x3f) * 255 / 63,
    (value & 0x1f) * 255 / 31
  ]
}

/** Décode les couleurs communes à DXT1 et DXT5 dans un bloc de 4×4. */
function decodeColorBlock(
  src: Buffer,
  at: number,
  out: Buffer,
  width: number,
  bx: number,
  by: number,
  height: number,
  punchThrough: boolean
): void {
  const c0 = src.readUInt16LE(at)
  const c1 = src.readUInt16LE(at + 2)
  const bits = src.readUInt32LE(at + 4)
  const [r0, g0, b0] = rgb565(c0)
  const [r1, g1, b1] = rgb565(c1)

  const palette: Array<[number, number, number, number]> = [
    [r0, g0, b0, 255],
    [r1, g1, b1, 255],
    [0, 0, 0, 255],
    [0, 0, 0, 255]
  ]

  // DXT1 réserve c0 <= c1 pour un mode à trois couleurs plus transparence.
  if (punchThrough && c0 <= c1) {
    palette[2] = [(r0 + r1) / 2, (g0 + g1) / 2, (b0 + b1) / 2, 255]
    palette[3] = [0, 0, 0, 0]
  } else {
    palette[2] = [(2 * r0 + r1) / 3, (2 * g0 + g1) / 3, (2 * b0 + b1) / 3, 255]
    palette[3] = [(r0 + 2 * r1) / 3, (g0 + 2 * g1) / 3, (b0 + 2 * b1) / 3, 255]
  }

  for (let py = 0; py < 4; py++) {
    for (let px = 0; px < 4; px++) {
      const x = bx + px
      const y = by + py
      if (x >= width || y >= height) continue
      const colour = palette[(bits >> (2 * (py * 4 + px))) & 0x03]!
      const o = (y * width + x) * 4
      out[o] = colour[0]
      out[o + 1] = colour[1]
      out[o + 2] = colour[2]
      out[o + 3] = colour[3]
    }
  }
}

function decodeDxt(src: Buffer, width: number, height: number, withAlpha: boolean): Buffer {
  const out = Buffer.alloc(width * height * 4)
  const stride = withAlpha ? 16 : 8
  let at = 0

  for (let by = 0; by < height; by += 4) {
    for (let bx = 0; bx < width; bx += 4) {
      const colourAt = withAlpha ? at + 8 : at
      decodeColorBlock(src, colourAt, out, width, bx, by, height, !withAlpha)

      if (withAlpha) {
        const a0 = src[at]!
        const a1 = src[at + 1]!
        const alpha: number[] = [a0, a1]
        if (a0 > a1) {
          for (let i = 1; i < 7; i++) alpha.push(((7 - i) * a0 + i * a1) / 7)
        } else {
          for (let i = 1; i < 5; i++) alpha.push(((5 - i) * a0 + i * a1) / 5)
          alpha.push(0, 255)
        }

        // Les indices alpha font 3 bits sur 48 bits : on lit les deux moitiés
        // en entiers séparés pour rester dans les entiers sûrs du JS.
        const low = src.readUIntLE(at + 2, 3)
        const high = src.readUIntLE(at + 5, 3)
        for (let i = 0; i < 16; i++) {
          const py = i >> 2
          const px = i & 3
          const x = bx + px
          const y = by + py
          if (x >= width || y >= height) continue
          const bitsSource = i < 8 ? low : high
          const shift = 3 * (i < 8 ? i : i - 8)
          out[(y * width + x) * 4 + 3] = alpha[(bitsSource >> shift) & 0x07]!
        }
      }

      at += stride
    }
  }

  return out
}

/* --------------------------------------------------------------------------
 * Lecture du conteneur
 * -------------------------------------------------------------------------- */

interface Block {
  type: string
  offset: number
  size: number
}

/** Décode un `.vtex_c` complet en pixels RGBA. */
export function decodeVtex(file: Buffer): DecodedTexture {
  let offset = 0
  const u32 = (): number => {
    const value = file.readUInt32LE(offset)
    offset += 4
    return value
  }
  const u16 = (): number => {
    const value = file.readUInt16LE(offset)
    offset += 2
    return value
  }
  const u8 = (): number => {
    const value = file.readUInt8(offset)
    offset += 1
    return value
  }

  u32() // taille déclarée de l'en-tête de ressource
  u16() // version d'en-tête
  u16() // version de ressource
  const blockOffset = u32()
  const blockCount = u32()

  offset = 8 + blockOffset
  const blocks: Block[] = []
  for (let i = 0; i < blockCount; i++) {
    const type = file.toString('ascii', offset, offset + 4)
    offset += 4
    const at = offset
    const relative = u32()
    const size = u32()
    blocks.push({ type, offset: at + relative, size })
  }

  const data = blocks.find((block) => block.type === 'DATA')
  if (!data) throw new Error('vtex : bloc DATA absent')

  offset = data.offset
  u16() // version
  u16() // drapeaux
  offset += 16 // réflectivité
  const width = u16()
  const height = u16()
  u16() // profondeur
  const format = u8()
  const mipCount = u8()
  u32() // picmip0Res
  const extraAt = offset
  const extraOffset = u32()
  const extraCount = u32()

  let compressedSizes: number[] | null = null
  offset = extraAt + extraOffset
  for (let i = 0; i < extraCount; i++) {
    const type = u32()
    const at = offset
    const relative = u32()
    u32() // longueur déclarée, qui ne couvre que l'en-tête du bloc
    const next = offset
    if (type === 4 /* COMPRESSED_MIP_SIZE */) {
      offset = at + relative
      const compressed = u32()
      u32() // inutilisé
      const count = u32()
      const sizes: number[] = []
      for (let m = 0; m < count; m++) sizes.push(u32())
      compressedSizes = compressed === 1 ? sizes : null
    }
    offset = next
  }

  /*
   * Les niveaux de mip sont rangés du plus petit au plus grand et empilés à la
   * fin du fichier. La pleine résolution est donc le dernier bloc, c'est-à-dire
   * les N derniers octets.
   */
  const pixelBytes = bytesPerImage(format, width, height)
  let payload: Buffer
  if (compressedSizes && compressedSizes.length > 0) {
    const mip0 = compressedSizes[compressedSizes.length - 1]!
    payload = lz4DecodeBlock(file.subarray(file.length - mip0), pixelBytes)
  } else {
    if (mipCount > 1) {
      throw new Error(`vtex : ${mipCount} mips non compressés, disposition non gérée`)
    }
    payload = file.subarray(file.length - pixelBytes)
  }

  return { width, height, rgba: toRgba(payload, format, width, height) }
}

function bytesPerImage(format: number, width: number, height: number): number {
  switch (format) {
    case Format.BGRA8888:
    case Format.RGBA8888:
      return width * height * 4
    case Format.DXT1:
      return Math.max(1, Math.ceil(width / 4)) * Math.max(1, Math.ceil(height / 4)) * 8
    case Format.DXT5:
      return Math.max(1, Math.ceil(width / 4)) * Math.max(1, Math.ceil(height / 4)) * 16
    default:
      throw new Error(`vtex : format ${FORMAT_NAMES[format] ?? format} non géré`)
  }
}

function toRgba(payload: Buffer, format: number, width: number, height: number): Buffer {
  switch (format) {
    case Format.RGBA8888:
      return Buffer.from(payload)
    case Format.BGRA8888: {
      const out = Buffer.from(payload)
      for (let i = 0; i < out.length; i += 4) {
        const blue = out[i]!
        out[i] = out[i + 2]!
        out[i + 2] = blue
      }
      return out
    }
    case Format.DXT1:
      return decodeDxt(payload, width, height, false)
    case Format.DXT5:
      return decodeDxt(payload, width, height, true)
    default:
      throw new Error(`vtex : format ${FORMAT_NAMES[format] ?? format} non géré`)
  }
}

/* --------------------------------------------------------------------------
 * PNG
 * -------------------------------------------------------------------------- */

const CRC_TABLE = (() => {
  const table = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c
  }
  return table
})()

function crc32(buffer: Buffer): number {
  let c = -1
  for (let i = 0; i < buffer.length; i++) c = CRC_TABLE[(c ^ buffer[i]!) & 0xff]! ^ (c >>> 8)
  return (c ^ -1) >>> 0
}

function pngChunk(type: string, data: Buffer): Buffer {
  const out = Buffer.alloc(data.length + 12)
  out.writeUInt32BE(data.length, 0)
  out.write(type, 4, 'ascii')
  data.copy(out, 8)
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length)
  return out
}

/**
 * Encode du RGBA brut en PNG.
 *
 * Écrit à la main plutôt qu'avec une bibliothèque : c'est une soixantaine de
 * lignes, l'opération n'arrive qu'à l'extraction des radars, et cela évite une
 * dépendance native de plus à empaqueter pour trois plateformes.
 */
export function encodePng(rgba: Buffer, width: number, height: number): Buffer {
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header[8] = 8 // bits par canal
  header[9] = 6 // RGBA
  header[10] = 0 // compression
  header[11] = 0 // filtrage
  header[12] = 0 // entrelacement

  const rowLength = width * 4 + 1
  const raw = Buffer.alloc(rowLength * height)
  for (let y = 0; y < height; y++) {
    raw[y * rowLength] = 0 // filtre « aucun »
    rgba.copy(raw, y * rowLength + 1, y * width * 4, (y + 1) * width * 4)
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0))
  ])
}
