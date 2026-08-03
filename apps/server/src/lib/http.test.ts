import { describe, expect, it } from 'vitest'
import { updatePlayerSchema, updateTeamSchema } from '@citronhud/contracts'
import { parsePatch } from './http'

/**
 * Le piège que ces tests verrouillent : `.partial()` de Zod rend les clés
 * facultatives mais **n'annule pas** les `.default()`. Sur nos schémas de mise à
 * jour, un `PATCH { nickname }` ressort donc avec `teamId: null`,
 * `avatarUrl: null`, `role: null`… Écrit tel quel, il détache le joueur de son
 * équipe et efface sa photo alors que personne n'y a touché.
 */

function patch(body: unknown): Request {
  return new Request('http://localhost/api/v1/players/1', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  })
}

describe('parsePatch', () => {
  it('ne garde que les champs réellement envoyés', async () => {
    const result = await parsePatch(patch({ nickname: 'zeste2' }), updatePlayerSchema)

    expect(result.error).toBeNull()
    expect(result.data).toEqual({ nickname: 'zeste2' })
  })

  it('conserve un effacement explicite', async () => {
    // `null` envoyé sciemment doit passer : c'est « retire l'équipe », et non
    // « ne touche pas à l'équipe ».
    const result = await parsePatch(patch({ teamId: null }), updatePlayerSchema)

    expect(result.data).toEqual({ teamId: null })
  })

  it('applique les transformations du schéma', async () => {
    const result = await parsePatch(patch({ color: '#FC0' }), updateTeamSchema)

    expect(result.data).toEqual({ color: '#ffcc00' })
  })

  it('accepte un corps vide sans rien inventer', async () => {
    const result = await parsePatch(patch({}), updatePlayerSchema)

    expect(result.data).toEqual({})
  })

  it('refuse une valeur invalide', async () => {
    const result = await parsePatch(patch({ steamId: '12345' }), updatePlayerSchema)

    expect(result.data).toBeNull()
    expect(result.error?.status).toBe(422)
  })

  it('refuse ce qui n’est pas un objet', async () => {
    expect((await parsePatch(patch([1, 2]), updatePlayerSchema)).error?.status).toBe(422)
    expect((await parsePatch(patch('bonjour'), updatePlayerSchema)).error?.status).toBe(422)
  })
})
