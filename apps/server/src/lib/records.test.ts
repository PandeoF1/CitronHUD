import { describe, expect, it } from 'vitest'
import { candidatesFrom, clampAchievedAt, subjectKeyOf, type RecordCandidate } from './records'

/**
 * L'arbitrage des records est la seule logique du serveur qui puisse *perdre*
 * quelque chose : un candidat mal normalisé est un record qui n'existera jamais,
 * sans erreur nulle part. On teste donc les deux formes d'entrée acceptées, la
 * correction d'horloge, et la clé de sujet dont dépend l'unicité en base.
 */

const RECEIVED = new Date('2026-08-03T12:00:00.000Z')

function candidate(patch: Partial<RecordCandidate> = {}): RecordCandidate {
  return {
    scope: 'player',
    metric: 'kills_match',
    steamId: '76561198000000001',
    playerName: 'zeste',
    playerAvatarUrl: null,
    teamId: null,
    teamName: null,
    value: 34,
    mapName: 'de_mirage',
    matchId: null,
    sessionId: null,
    achievedAt: RECEIVED.toISOString(),
    ...patch
  }
}

describe('candidatesFrom', () => {
  it('lit l’enveloppe décrite par le contrat', () => {
    const result = candidatesFrom(
      {
        sessionId: 'session-1',
        candidates: [candidate(), candidate({ metric: 'adr_match', value: 92.4 })]
      },
      RECEIVED
    )

    expect(result.candidates).toHaveLength(2)
    expect(result.unusable).toBe(0)
    expect(result.candidates[0]!.metric).toBe('kills_match')
    // La session de l'enveloppe descend sur les candidats qui n'en portent pas.
    expect(result.candidates[0]!.sessionId).toBe('session-1')
  })

  /*
   * La forme que le client envoie réellement : sa file d'envoi poste un
   * évènement de record isolé, sans enveloppe. La refuser reviendrait à perdre
   * exactement les records accumulés hors ligne.
   */
  it('accepte un évènement de record isolé', () => {
    const result = candidatesFrom(
      {
        metric: 'kills_round',
        scope: 'player',
        label: 'Kills sur une manche',
        steamId: '76561198000000002',
        playerName: 'pépin',
        playerAvatarUrl: null,
        value: 5,
        previousValue: 4,
        unit: 'count'
      },
      RECEIVED
    )

    expect(result.candidates).toHaveLength(1)
    expect(result.candidates[0]!.value).toBe(5)
    // Absent de l'évènement : l'heure de réception fait foi.
    expect(result.candidates[0]!.achievedAt).toBe(RECEIVED.toISOString())
  })

  it('écarte ce qui n’est pas exploitable plutôt que de le deviner', () => {
    const cases = [
      { sessionId: 's', candidates: [{ metric: 'kills_match' }] },
      { metric: 'kills_match', scope: 'player', value: 'beaucoup' },
      null,
      'bonjour'
    ]
    for (const input of cases) {
      expect(candidatesFrom(input).candidates).toEqual([])
    }
  })

  /*
   * Le cas qui a motivé la validation stricte : `metric` était transtypée sans
   * contrôle, donc une métrique inconnue traversait jusqu'à `beatsRecord`, où
   * `RECORD_DIRECTION[metric]` vaut `undefined`. La comparaison basculait alors
   * sur « plus petit c'est mieux » et le record s'arbitrait à l'envers — un
   * client plus récent que le serveur suffisait à déclencher ça.
   */
  it('refuse une métrique que ce serveur ne connaît pas', () => {
    const result = candidatesFrom({
      metric: 'most_kills_round',
      scope: 'player',
      steamId: '76561198000000002',
      value: 5
    })

    expect(result.candidates).toEqual([])
    expect(result.unusable).toBe(1)
  })

  it('refuse une portée inconnue', () => {
    const result = candidatesFrom({ metric: 'kills_match', scope: 'planete', value: 5 })
    expect(result.candidates).toEqual([])
    expect(result.unusable).toBe(1)
  })

  /** Un candidat illisible ne doit pas emporter ceux qui sont valides. */
  it('garde les candidats valides et compte les autres', () => {
    const result = candidatesFrom({
      sessionId: 'session-1',
      candidates: [candidate(), { metric: 'inconnue', scope: 'player', value: 3 }]
    })

    expect(result.candidates).toHaveLength(1)
    expect(result.unusable).toBe(1)
  })
})

describe('clampAchievedAt', () => {
  it('garde une date plausible', () => {
    const past = '2026-08-03T11:30:00.000Z'
    expect(clampAchievedAt(past, RECEIVED)).toBe(past)
  })

  /*
   * Les machines de régie sont souvent hors domaine et leur horloge dérive. On
   * corrige la date sans jeter le record : un ace reste un ace même sur une
   * machine mal réglée.
   */
  it('ramène une date trop lointaine à l’heure du serveur', () => {
    const future = '2027-01-01T00:00:00.000Z'
    expect(clampAchievedAt(future, RECEIVED)).toBe(RECEIVED.toISOString())
  })

  it('tolère la dérive d’horloge ordinaire', () => {
    const slightlyAhead = '2026-08-03T12:30:00.000Z'
    expect(clampAchievedAt(slightlyAhead, RECEIVED)).toBe(slightlyAhead)
  })

  it('remplace une date illisible', () => {
    expect(clampAchievedAt('hier', RECEIVED)).toBe(RECEIVED.toISOString())
    expect(clampAchievedAt(undefined, RECEIVED)).toBe(RECEIVED.toISOString())
  })
})

describe('subjectKeyOf', () => {
  it('rattache un record de joueur à son SteamID', () => {
    expect(subjectKeyOf(candidate())).toBe('76561198000000001')
  })

  it('rattache un record d’équipe à son identifiant', () => {
    expect(subjectKeyOf(candidate({ scope: 'team', teamId: 'equipe-1' }))).toBe('equipe-1')
  })

  /*
   * La portée globale n'a qu'une ligne par métrique : le sujet est vide, pas le
   * détenteur. Renvoyer son SteamID créerait une ligne « globale » par joueur.
   */
  it('n’attribue aucun sujet à la portée globale', () => {
    expect(subjectKeyOf(candidate({ scope: 'global' }))).toBe('')
  })

  it('refuse ce qu’on ne saurait pas comparer', () => {
    expect(subjectKeyOf(candidate({ steamId: null }))).toBeNull()
    expect(subjectKeyOf(candidate({ scope: 'team', teamId: null }))).toBeNull()
  })
})
