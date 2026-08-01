import { useState } from 'react'
import type { Slot, Team, TeamSlot } from '@citronhud/contracts'

/**
 * Sélection d'une équipe pour un côté de l'écran.
 *
 * Deux provenances, et c'est volontairement le filet de sécurité qui décide de
 * la conception : le streamer doit pouvoir diffuser même quand RIEN n'a été
 * préparé côté serveur. Le nom à la volée n'est donc pas un mode dégradé caché,
 * c'est un onglet au même niveau que le roster.
 */

interface TeamPickerProps {
  slot: Slot
  value: TeamSlot
  teams: Team[]
  onChange: (team: TeamSlot) => void
}

export function TeamPicker({ slot, value, teams, onChange }: TeamPickerProps) {
  const [mode, setMode] = useState<'roster' | 'adhoc'>(
    value.source === 'adhoc' ? 'adhoc' : 'roster'
  )
  const [name, setName] = useState(value.source === 'adhoc' ? value.name : '')
  const [shortName, setShortName] = useState(value.source === 'adhoc' ? value.shortName : '')

  const applyAdhoc = (nextName: string, nextShort: string): void => {
    if (!nextName.trim()) {
      onChange({ source: 'unset' })
      return
    }
    onChange({
      source: 'adhoc',
      name: nextName.trim(),
      // Sans sigle saisi, on en dérive un : le HUD a besoin d'une forme courte
      // et demander deux champs pour une équipe de scrim est une friction.
      shortName: (nextShort.trim() || nextName.trim().slice(0, 3)).toUpperCase(),
      color: null,
      logoUrl: null
    })
  }

  return (
    <div className="picker">
      <span className="picker__side">{slot === 'left' ? 'Gauche' : 'Droite'}</span>

      <div className="picker__modes">
        <button
          className="chip"
          data-active={mode === 'roster'}
          onClick={() => setMode('roster')}
          disabled={teams.length === 0}
          title={teams.length === 0 ? 'Aucune équipe synchronisée depuis le serveur' : undefined}
        >
          Roster
        </button>
        <button className="chip" data-active={mode === 'adhoc'} onClick={() => setMode('adhoc')}>
          Nom libre
        </button>
      </div>

      {mode === 'roster' ? (
        <select
          className="input"
          value={value.source === 'roster' ? value.teamId : ''}
          onChange={(event) => {
            const id = event.target.value
            onChange(id ? { source: 'roster', teamId: id } : { source: 'unset' })
          }}
        >
          <option value="">— Aucune équipe —</option>
          {teams.map((team) => (
            <option key={team.id} value={team.id}>
              {team.name}
            </option>
          ))}
        </select>
      ) : (
        <div className="picker__adhoc">
          <input
            className="input"
            placeholder="Nom de l’équipe"
            value={name}
            onChange={(event) => {
              setName(event.target.value)
              applyAdhoc(event.target.value, shortName)
            }}
          />
          <input
            className="input input--short"
            placeholder="SIG"
            maxLength={6}
            value={shortName}
            onChange={(event) => {
              setShortName(event.target.value)
              applyAdhoc(name, event.target.value)
            }}
          />
        </div>
      )}
    </div>
  )
}
