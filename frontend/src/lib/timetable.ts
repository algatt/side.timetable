import { assertLabInventory } from './labs.ts'
import type { LabInventory } from './labs.ts'

export const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'] as const
export type Weekday = typeof WEEKDAYS[number]
export interface Entry {
  id: string
  group: string
  weekday: Weekday
  start: string
  end: string
  duration_minutes: number
  subject_code: string | null
  subject_name: string
  subject_id: string | null
  entry_kind: 'lesson' | 'activity'
  code_status: 'complete' | 'placeholder' | 'missing'
  rooms: string[]
  source_page: number
  raw_text: string
  notes: string[]
}
export interface Group {
  id: string
  label: string
  entry_count: number
  lesson_count: number
  activity_count: number
}
export interface Dataset {
  schema_version: number
  generated_at: string
  timezone: string
  schedule_kind: string
  validation_status: string
  source: { pdf_url: string | null; sha256: string; page_count: number }
  groups: Group[]
  entries: Entry[]
  rooms: string[]
  schedule_coverage?: { weekdays: Weekday[]; start: string; end: string } | null
  lab_inventory?: LabInventory
}

export function toMinutes(time: string): number {
  if (!/^\d{2}:\d{2}$/.test(time)) throw new Error(`Invalid time: ${time}`)
  const [hour, minute] = time.split(':').map(Number)
  if (hour > 23 || minute > 59) throw new Error(`Invalid time: ${time}`)
  return hour * 60 + minute
}

export function assertDataset(value: unknown): asserts value is Dataset {
  if (!value || typeof value !== 'object') throw new Error('Timetable data is missing.')
  const data = value as Dataset
  if (data.schema_version !== 1 || data.schedule_kind !== 'weekly' || data.timezone !== 'Europe/Malta' ||
      !['passed', 'passed_with_warnings'].includes(data.validation_status) ||
      !Array.isArray(data.groups) || !data.groups.length || !Array.isArray(data.entries) || !Array.isArray(data.rooms) ||
      !data.rooms.every(room => typeof room === 'string' && room.length > 0) || new Set(data.rooms).size !== data.rooms.length ||
      !data.source || typeof data.source.sha256 !== 'string' || !Number.isFinite(Date.parse(data.generated_at))) {
    throw new Error('The timetable data format is unsupported or its validation failed.')
  }
  if (data.schedule_coverage && (!Array.isArray(data.schedule_coverage.weekdays) || !data.schedule_coverage.weekdays.length ||
      !data.schedule_coverage.weekdays.every(day => WEEKDAYS.includes(day)) ||
      toMinutes(data.schedule_coverage.start) >= toMinutes(data.schedule_coverage.end))) {
    throw new Error('Invalid published schedule coverage.')
  }
  const groupIds = new Set<string>()
  if (data.lab_inventory) assertLabInventory(data.lab_inventory)
  for (const group of data.groups) {
    if (typeof group.id !== 'string' || !group.id || typeof group.label !== 'string' || groupIds.has(group.id)) {
      throw new Error('Invalid or duplicate timetable group.')
    }
    groupIds.add(group.id)
  }
  const ids = new Set<string>()
  for (const entry of data.entries) {
    if (typeof entry.id !== 'string' || ids.has(entry.id) || !groupIds.has(entry.group) ||
        !WEEKDAYS.includes(entry.weekday) || typeof entry.subject_name !== 'string' || !entry.subject_name.trim() ||
        !['lesson', 'activity'].includes(entry.entry_kind) || !['complete', 'placeholder', 'missing'].includes(entry.code_status) ||
        !(entry.subject_code === null || typeof entry.subject_code === 'string') ||
        !Array.isArray(entry.rooms) || !entry.rooms.every(room => typeof room === 'string' && data.rooms.includes(room)) ||
        !Array.isArray(entry.notes) || !entry.notes.every(note => typeof note === 'string') ||
        typeof entry.raw_text !== 'string' || !Number.isInteger(entry.source_page) || entry.source_page < 1 ||
        entry.source_page > data.source.page_count || entry.duration_minutes <= 0 ||
        toMinutes(entry.end) - toMinutes(entry.start) !== entry.duration_minutes) {
      throw new Error(`Invalid timetable entry: ${entry.id || 'unknown'}.`)
    }
    ids.add(entry.id)
  }
}

export function sourceUrl(url: string | null, page?: number): string | undefined {
  if (!url) return undefined
  try {
    const parsed = new URL(url)
    if (!['https:', 'http:'].includes(parsed.protocol)) return undefined
    if (page !== undefined) parsed.hash = `page=${page}`
    return parsed.href
  } catch { return undefined }
}

export function entriesForGroup(data: Dataset, group: string): Entry[] {
  return data.entries.filter(entry => entry.group === group).sort((a, b) =>
    WEEKDAYS.indexOf(a.weekday) - WEEKDAYS.indexOf(b.weekday) || a.start.localeCompare(b.start) || a.id.localeCompare(b.id))
}

export function scheduleRooms(data: Dataset): string[] {
  return [...new Set([...data.rooms, ...(data.lab_inventory?.rooms.map(lab => lab.room) ?? [])])]
    .filter(room => room.startsWith('ICT-')).sort((a, b) => a.localeCompare(b, 'en', { numeric: true }))
}

export function entriesForRoom(data: Dataset, room: string): Entry[] {
  return data.entries.filter(entry => entry.rooms.includes(room)).sort((a, b) =>
    WEEKDAYS.indexOf(a.weekday) - WEEKDAYS.indexOf(b.weekday) || a.start.localeCompare(b.start) || a.id.localeCompare(b.id))
}

export function hasSourceNote(entry: Entry): boolean {
  return entry.code_status !== 'complete' || entry.rooms.length === 0
}

export function subjectTone(entry: Entry): string {
  const key = `${entry.subject_code ?? ''}:${entry.subject_name.toLowerCase()}`
  let hash = 0
  for (const character of key) hash = (hash * 31 + character.charCodeAt(0)) | 0
  return ['blue', 'teal', 'violet', 'amber', 'slate'][Math.abs(hash) % 5]
}

export function timeRange(entries: Entry[]): { start: number; end: number } {
  return {
    start: Math.floor(Math.min(8 * 60, ...entries.map(entry => toMinutes(entry.start))) / 60) * 60,
    end: Math.ceil(Math.max(16 * 60, ...entries.map(entry => toMinutes(entry.end))) / 60) * 60,
  }
}

export interface PositionedEntry { entry: Entry; lane: number; lanes: number }
export function layoutDay(entries: Entry[]): PositionedEntry[] {
  const sorted = [...entries].sort((a, b) => a.start.localeCompare(b.start) || b.end.localeCompare(a.end) || a.id.localeCompare(b.id))
  const result: PositionedEntry[] = []
  let cluster: Entry[] = []
  let clusterEnd = -1
  function flush() {
    const laneEnds: number[] = []
    const positioned = cluster.map(entry => {
      const start = toMinutes(entry.start)
      let lane = laneEnds.findIndex(end => end <= start)
      if (lane === -1) lane = laneEnds.length
      laneEnds[lane] = toMinutes(entry.end)
      return { entry, lane }
    })
    for (const item of positioned) result.push({ ...item, lanes: laneEnds.length })
  }
  for (const entry of sorted) {
    const start = toMinutes(entry.start)
    if (cluster.length && start >= clusterEnd) { flush(); cluster = []; clusterEnd = -1 }
    cluster.push(entry)
    clusterEnd = Math.max(clusterEnd, toMinutes(entry.end))
  }
  if (cluster.length) flush()
  return result
}

export function entryLabel(entry: Entry): string {
  return `${entry.subject_name}, ${entry.weekday} ${entry.start} to ${entry.end}, ${entry.rooms.length ? entry.rooms.join(' and ') : 'room not specified'}`
}
