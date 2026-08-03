import { describe, expect, it } from 'vitest'
import { newApiKey, slugify } from './ids'

describe('slugify', () => {
  it('produit un slug conforme au schéma d’équipe', () => {
    expect(slugify('Citron Esport')).toBe('citron-esport')
  })

  /*
   * Sans décomposition Unicode, « Élite » laisserait un caractère accentué que
   * le schéma refuse — et l'erreur tomberait à la validation, loin d'ici.
   */
  it('retire les accents', () => {
    expect(slugify('Citron Élite')).toBe('citron-elite')
  })

  it('n’ouvre ni ne termine sur un tiret', () => {
    expect(slugify('  — Citron —  ')).toBe('citron')
  })

  it('respecte la longueur maximale du schéma', () => {
    expect(slugify('a'.repeat(80)).length).toBe(48)
  })
})

describe('newApiKey', () => {
  it('reste reconnaissable dans un fichier de configuration', () => {
    expect(newApiKey()).toMatch(/^citron_[A-Za-z0-9_-]{32}$/)
  })

  it('ne se répète pas', () => {
    const keys = new Set(Array.from({ length: 200 }, newApiKey))
    expect(keys.size).toBe(200)
  })
})
