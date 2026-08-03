import type { PlayerRow, TeamRow } from '../../../db/schema'

const ROLES = ['igl', 'awper', 'entry', 'support', 'lurker', 'rifler'] as const

/**
 * Champs d'un joueur, partagés par la création et l'édition.
 *
 * Le SteamID est en tête et signalé comme la clé : c'est le seul champ dont une
 * erreur rend le reste inutile — un joueur mal identifié n'est jamais reconnu
 * dans le flux, quel que soit le soin apporté à sa fiche.
 */
export function PlayerFields({ player, teams }: { player?: PlayerRow; teams: TeamRow[] }) {
  const socials = (player?.socials ?? {}) as Record<string, string | null>

  return (
    <div className="form">
      <div className="field">
        <label htmlFor="steamId">SteamID64</label>
        <input
          id="steamId"
          name="steamId"
          type="text"
          inputMode="numeric"
          pattern="7656119[0-9]{10}"
          placeholder="76561198000000000"
          defaultValue={player?.steamId ?? ''}
          required
        />
        <span className="hint">La clé qui relie ce joueur au flux du jeu.</span>
      </div>

      <div className="field">
        <label htmlFor="nickname">Pseudo</label>
        <input
          id="nickname"
          name="nickname"
          type="text"
          maxLength={32}
          defaultValue={player?.nickname ?? ''}
          required
        />
        <span className="hint">Prime toujours sur le nom renvoyé par le jeu.</span>
      </div>

      <div className="field">
        <label htmlFor="teamId">Équipe</label>
        <select id="teamId" name="teamId" defaultValue={player?.teamId ?? ''}>
          <option value="">Sans équipe</option>
          {teams.map((team) => (
            <option key={team.id} value={team.id}>
              {team.name}
            </option>
          ))}
        </select>
      </div>

      <div className="field">
        <label htmlFor="role">Rôle</label>
        <select id="role" name="role" defaultValue={player?.role ?? ''}>
          <option value="">Non précisé</option>
          {ROLES.map((role) => (
            <option key={role} value={role}>
              {role}
            </option>
          ))}
        </select>
      </div>

      <div className="field">
        <label htmlFor="firstName">Prénom</label>
        <input id="firstName" name="firstName" type="text" defaultValue={player?.firstName ?? ''} />
      </div>

      <div className="field">
        <label htmlFor="lastName">Nom</label>
        <input id="lastName" name="lastName" type="text" defaultValue={player?.lastName ?? ''} />
      </div>

      <div className="field">
        <label htmlFor="country">Pays</label>
        <input
          id="country"
          name="country"
          type="text"
          maxLength={2}
          placeholder="FR"
          defaultValue={player?.country ?? ''}
        />
      </div>

      <div className="field">
        <label htmlFor="avatarUrl">Photo (URL)</label>
        <input id="avatarUrl" name="avatarUrl" type="url" defaultValue={player?.avatarUrl ?? ''} />
      </div>

      <div className="field">
        <label htmlFor="twitch">Twitch</label>
        <input id="twitch" name="twitch" type="text" defaultValue={socials.twitch ?? ''} />
      </div>

      <div className="field">
        <label htmlFor="x">X</label>
        <input id="x" name="x" type="text" defaultValue={socials.x ?? ''} />
      </div>

      <div className="field">
        <label htmlFor="instagram">Instagram</label>
        <input id="instagram" name="instagram" type="text" defaultValue={socials.instagram ?? ''} />
      </div>

      <div className="field">
        <label className="checkbox">
          <input type="checkbox" name="isCoach" defaultChecked={player?.isCoach ?? false} />
          Coach — masqué de l’overlay
        </label>
        <span className="hint">
          Le client sait aussi le déduire tout seul ; le cocher ici évite d’attendre deux manches.
        </span>
      </div>
    </div>
  )
}
