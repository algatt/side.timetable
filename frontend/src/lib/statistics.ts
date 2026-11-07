import type { Entry, Weekday } from './timetable.ts'
import { WEEKDAYS } from './timetable.ts'

export interface DailyLessonHours { day: Weekday; minutes: number }
export interface LessonStatistics {
  lessons: number
  minutes: number
  days: Weekday[]
  byDay: DailyLessonHours[]
}
export interface UnitStatistics extends LessonStatistics {
  id: string
  name: string
  code: string | null
  codeStatus: Entry['code_status']
  names: string[]
  groups: string[]
}
export interface GroupStatistics extends LessonStatistics {
  id: string
  units: number
}

// Complete unit codes identify a unit even when the PDF varies its name.
// Missing/placeholder codes need the printed name to avoid unrelated merges.
export function unitIdentity(entry: Entry): string {
  if (entry.subject_code && entry.code_status === 'complete') return JSON.stringify(['code', entry.subject_code])
  return JSON.stringify(['name', entry.subject_code ?? '', entry.subject_name.trim().toLowerCase().replace(/\s+/g, ' ')])
}

export function timetableStatistics(entries: readonly Entry[]) {
  const lessons = entries.filter(entry => entry.entry_kind === 'lesson')
  const unitEntries = new Map<string, Entry[]>()
  const groupEntries = new Map<string, Entry[]>()
  for (const entry of lessons) {
    const unit = unitIdentity(entry)
    if (!unitEntries.has(unit)) unitEntries.set(unit, [])
    if (!groupEntries.has(entry.group)) groupEntries.set(entry.group, [])
    unitEntries.get(unit)!.push(entry)
    groupEntries.get(entry.group)!.push(entry)
  }
  function summary(items: readonly Entry[]): LessonStatistics {
    return {
      lessons: items.length,
      minutes: items.reduce((sum, entry) => sum + entry.duration_minutes, 0),
      days: WEEKDAYS.filter(day => items.some(entry => entry.weekday === day)),
      byDay: WEEKDAYS.map(day => ({ day, minutes: items.filter(entry => entry.weekday === day).reduce((sum, entry) => sum + entry.duration_minutes, 0) })),
    }
  }
  const units: UnitStatistics[] = [...unitEntries].map(([id, items]) => {
    const names = [...new Set(items.map(entry => entry.subject_name))]
      .sort((a, b) => a.length - b.length || a.localeCompare(b))
    return {
      id, name: names[0], names, code: items[0].subject_code,
      codeStatus: items[0].code_status,
      groups: [...new Set(items.map(entry => entry.group))].sort((a, b) => a.localeCompare(b, 'en', { numeric: true })),
      ...summary(items),
    }
  })
  const groups: GroupStatistics[] = [...groupEntries].map(([id, items]) => ({
    id, units: new Set(items.map(unitIdentity)).size, ...summary(items),
  }))
  return { units, groups, ...summary(lessons), excludedActivities: entries.length - lessons.length }
}

export const lessonHours = (minutes: number): string => new Intl.NumberFormat('en-GB', { maximumFractionDigits: 2 }).format(minutes / 60)

// One scale per table, rounded up to whole hours; filtering and sorting do not
// change the main table's scale or make short days look like full days.
export function dailyHoursScale(rows: readonly LessonStatistics[]): number {
  return Math.max(60, Math.ceil(Math.max(0, ...rows.flatMap(row => row.byDay.map(day => day.minutes))) / 60) * 60)
}
