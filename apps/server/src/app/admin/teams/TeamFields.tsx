import type { TeamRow } from '../../../db/schema'

/**
 * Champs d'une équipe, partagés par la création et l'édition.
 *
 * Un seul jeu de champs pour les deux écrans : c'est ce qui garantit qu'un
 * champ ajouté demain apparaîtra dans les deux, au lieu d'être saisissable à la
 * création et invisible ensuite.
 */
export function TeamFields({ team }: { team?: TeamRow }) {
  return (
    <div className="form">
      <div className="field">
        <label htmlFor="name">Nom</label>
        <input id="name" name="name" type="text" defaultValue={team?.name ?? ''} required />
      </div>

      <div className="field">
        <label htmlFor="shortName">Nom court</label>
        <input
          id="shortName"
          name="shortName"
          type="text"
          maxLength={6}
          defaultValue={team?.shortName ?? ''}
          required
        />
        <span className="hint">6 caractères maximum — c’est ce qu’affiche la matchbar.</span>
      </div>

      <div className="field">
        <label htmlFor="slug">Slug</label>
        <input id="slug" name="slug" type="text" defaultValue={team?.slug ?? ''} />
        <span className="hint">Déduit du nom s’il est laissé vide.</span>
      </div>

      <div className="field">
        <label htmlFor="country">Pays</label>
        <input
          id="country"
          name="country"
          type="text"
          maxLength={2}
          placeholder="FR"
          defaultValue={team?.country ?? ''}
        />
      </div>

      <div className="field">
        <label htmlFor="logoUrl">Logo (URL)</label>
        <input id="logoUrl" name="logoUrl" type="url" defaultValue={team?.logoUrl ?? ''} />
      </div>

      <div className="field">
        <label htmlFor="color">Couleur</label>
        <input
          id="color"
          name="color"
          type="text"
          placeholder="#FFC800"
          defaultValue={team?.color ?? ''}
        />
        <span className="hint">Facultative : sans elle, l’équipe prend la couleur de son camp.</span>
      </div>
    </div>
  )
}
