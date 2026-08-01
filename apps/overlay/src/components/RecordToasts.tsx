import type { RecordBroken } from '@citronhud/contracts'
import { initials } from '../lib/format'

/**
 * Bandeaux de record.
 *
 * C'est ce qui transforme une statistique en récit : « 34 kills » n'est qu'un
 * nombre, « 34 kills, record de la saison, l'ancien était 31 » est un moment de
 * diffusion. On montre donc toujours l'ancienne valeur à côté de la nouvelle.
 */

interface RecordToastsProps {
  records: Array<RecordBroken & { id: number }>
}

/** Met en forme selon l'unité déclarée par le contrat, sans table parallèle. */
function formatValue(value: number, unit: RecordBroken['unit']): string {
  switch (unit) {
    case 'percent':
      return `${Math.round(value)}%`
    case 'milliseconds':
      return `${(value / 1000).toFixed(2).replace('.', ',')} s`
    case 'decimal':
      return value.toFixed(1).replace('.', ',')
    default:
      return String(Math.round(value))
  }
}

export function RecordToasts({ records }: RecordToastsProps) {
  if (records.length === 0) return null

  return (
    <div className="records">
      {records.map((record) => (
        <div key={record.id} className="record plate">
          {record.playerAvatarUrl ? (
            <img className="record__avatar plate" src={record.playerAvatarUrl} alt="" />
          ) : (
            record.playerName && (
              <div className="record__avatar plate" aria-hidden="true">
                {initials(record.playerName)}
              </div>
            )
          )}

          <div className="col">
            <span className="record__label">Record battu</span>
            <span className="record__title">
              {record.playerName ? `${record.playerName} — ` : ''}
              {record.label}
            </span>
            <span className="record__value">
              <b>{formatValue(record.value, record.unit)}</b>
              {record.previousValue !== null && (
                <span className="record__previous">
                  {formatValue(record.previousValue, record.unit)}
                </span>
              )}
            </span>
          </div>
        </div>
      ))}
    </div>
  )
}
