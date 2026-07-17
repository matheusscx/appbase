import { describe, expect, it } from 'vitest'
import {
  fromCalendarDate,
  fromCalendarDateTime,
  fromTime,
  mergeDateKeepingTime,
  toCalendarDate,
  toCalendarDateTime,
  toTime,
} from './date-value'

describe('date-value', () => {
  it('roundtrip date YYYY-MM-DD', () => {
    const d = toCalendarDate('2026-07-17')
    expect(d).not.toBeNull()
    expect(fromCalendarDate(d)).toBe('2026-07-17')
  })

  it('roundtrip datetime-local', () => {
    const d = toCalendarDateTime('2026-07-17T13:24')
    expect(d).not.toBeNull()
    expect(fromCalendarDateTime(d)).toBe('2026-07-17T13:24')
  })

  it('mergeDateKeepingTime conserva hora', () => {
    const current = toCalendarDateTime('2026-07-17T13:24')!
    const picked = toCalendarDate('2026-07-25')!
    const merged = mergeDateKeepingTime(picked, current)
    expect(fromCalendarDateTime(merged)).toBe('2026-07-25T13:24')
  })

  it('roundtrip HH:mm', () => {
    const t = toTime('08:00')
    expect(t).not.toBeNull()
    expect(fromTime(t)).toBe('08:00')
    expect(fromTime(toTime('19:30:00'))).toBe('19:30')
  })

  it('hora inválida → null', () => {
    expect(toTime('25:00')).toBeNull()
    expect(toTime('')).toBeNull()
    expect(fromTime(null)).toBe('')
  })
})
