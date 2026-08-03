import { asc, gt, type SQL } from 'drizzle-orm'
import type { PgColumn } from 'drizzle-orm/pg-core'

/**
 * Pagination par curseur.
 *
 * Par curseur et non par décalage : les listes de l'admin s'allongent pendant
 * qu'on les parcourt — un client qui synchronise pousse des temps forts en
 * continu. Avec un `OFFSET`, chaque insertion décale les pages suivantes et
 * fait réapparaître ou disparaître des lignes déjà vues.
 */

export interface Page<T> {
  items: T[]
  nextCursor: string | null
}

/** Condition de reprise après un curseur, ou `undefined` pour la première page. */
export function after(column: PgColumn, cursor: string | undefined): SQL | undefined {
  return cursor ? gt(column, cursor) : undefined
}

export const byCursor = (column: PgColumn) => asc(column)

/**
 * Découpe le résultat.
 *
 * On demande toujours une ligne de plus que la limite : sa présence dit qu'il
 * reste une page, sans exiger un `COUNT(*)` sur toute la table.
 */
export function paginate<Row, Item>(
  rows: Row[],
  limit: number,
  toItem: (row: Row) => Item,
  cursorOf: (row: Row) => string
): Page<Item> {
  const hasMore = rows.length > limit
  const visible = hasMore ? rows.slice(0, limit) : rows
  const last = visible[visible.length - 1]
  return {
    items: visible.map(toItem),
    nextCursor: hasMore && last ? cursorOf(last) : null
  }
}
