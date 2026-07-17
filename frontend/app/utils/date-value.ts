import {
  CalendarDate,
  CalendarDateTime,
  parseDate,
  parseDateTime,
  parseTime,
  type DateValue,
  type Time,
} from '@internationalized/date'

/** YYYY-MM-DD → CalendarDate */
export function toCalendarDate(value: string | null | undefined): CalendarDate | null {
  if (!value) return null
  try {
    return parseDate(value.slice(0, 10))
  }
  catch {
    return null
  }
}

/** CalendarDate / DateValue → YYYY-MM-DD */
export function fromCalendarDate(value: DateValue | null | undefined): string {
  if (!value) return ''
  const y = value.year
  const m = String(value.month).padStart(2, '0')
  const d = String(value.day).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/**
 * datetime-local / ISO parcial → CalendarDateTime.
 * Acepta `YYYY-MM-DDTHH:mm`, `YYYY-MM-DDTHH:mm:ss` o ISO con zona.
 */
export function toCalendarDateTime(
  value: string | null | undefined,
): CalendarDateTime | null {
  if (!value) return null
  const match = value.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})(?::(\d{2}))?/)
  if (match) {
    try {
      return parseDateTime(`${match[1]}:${match[2] ?? '00'}`)
    }
    catch {
      // fallback abajo
    }
  }
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return null
  return new CalendarDateTime(
    d.getFullYear(),
    d.getMonth() + 1,
    d.getDate(),
    d.getHours(),
    d.getMinutes(),
  )
}

/** CalendarDateTime → `YYYY-MM-DDTHH:mm` (datetime-local) */
export function fromCalendarDateTime(
  value: CalendarDateTime | null | undefined,
): string {
  if (!value) return ''
  const date = fromCalendarDate(value)
  const hh = String(value.hour).padStart(2, '0')
  const mm = String(value.minute).padStart(2, '0')
  return `${date}T${hh}:${mm}`
}

/** Al elegir día en el calendario, conservar hora/minuto actuales. */
export function mergeDateKeepingTime(
  picked: DateValue,
  current: CalendarDateTime | null,
): CalendarDateTime {
  return new CalendarDateTime(
    picked.year,
    picked.month,
    picked.day,
    current?.hour ?? 0,
    current?.minute ?? 0,
  )
}

/** `HH:mm` o `HH:mm:ss` → Time */
export function toTime(value: string | null | undefined): Time | null {
  if (!value) return null
  const match = value.trim().match(/^([01]?\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?$/)
  if (!match) return null
  try {
    const normalized = `${match[1]!.padStart(2, '0')}:${match[2]}${match[3] ? `:${match[3]}` : ''}`
    return parseTime(normalized)
  }
  catch {
    return null
  }
}

/** Time → `HH:mm` (contrato API turnos) */
export function fromTime(value: Time | null | undefined): string {
  if (!value) return ''
  const hh = String(value.hour).padStart(2, '0')
  const mm = String(value.minute).padStart(2, '0')
  return `${hh}:${mm}`
}
