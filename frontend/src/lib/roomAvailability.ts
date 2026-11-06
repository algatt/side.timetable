import { toMinutes } from './timetable.ts'
import type { Dataset, Entry, Weekday } from './timetable.ts'
import { emptyLabFilters, hasLabFilters, labFilterError, matchesLab } from './labs.ts'
import type { LabFilters } from './labs.ts'

export interface RoomRequest {
  weekday: Weekday
  start: string
  end: string
  building: string
  roomQuery: string
  labFilters?: LabFilters
}
export interface RoomResult {
  room: string
  available: boolean
  overlaps: Entry[]
  dayEntries: Entry[]
  nextStart: string | null
}

export function validateRoomRequest(data: Dataset, request: RoomRequest): string | null {
  const coverage = data.schedule_coverage
  if (!coverage) return 'Search hours are unavailable for this timetable.'
  if (!coverage.weekdays.includes(request.weekday)) return 'Choose a weekday represented in the published timetable.'
  let start: number, end: number
  try { start = toMinutes(request.start); end = toMinutes(request.end) }
  catch { return 'Choose a valid start and end time.' }
  if (start >= end) return 'The end time must be later than the start time.'
  if (start < toMinutes(coverage.start) || end > toMinutes(coverage.end)) {
    return `Choose times within the published hours: ${coverage.start}–${coverage.end}.`
  }
  if (!['ICT', 'all'].includes(request.building)) return 'Room availability is limited to ICT rooms.'
  const filters = request.labFilters ?? emptyLabFilters()
  const filterError = labFilterError(filters)
  if (filterError) return filterError
  if (hasLabFilters(filters) && !data.lab_inventory) return 'Lab details are unavailable for these filters.'
  return null
}

export function overlapsInterval(entry: Entry, start: string, end: string): boolean {
  // Half-open intervals: a booking ending at the search start does not overlap.
  return toMinutes(entry.start) < toMinutes(end) && toMinutes(entry.end) > toMinutes(start)
}

export function findRooms(data: Dataset, request: RoomRequest): RoomResult[] {
  const error = validateRoomRequest(data, request)
  if (error) throw new Error(error)
  const query = request.roomQuery.toUpperCase().replace(/[\s-]+/g, '')
  // Use every group and every listed room, rather than the currently selected group.
  const entries = data.entries.filter(entry => entry.weekday === request.weekday)
  const profiles = new Map(data.lab_inventory?.rooms.map(lab => [lab.room, lab]) ?? [])
  return data.rooms.filter(room => room.startsWith('ICT-') &&
    room.toUpperCase().replace(/[\s-]+/g, '').includes(query) && matchesLab(profiles.get(room), request.labFilters ?? emptyLabFilters()))
    .sort((a, b) => a.localeCompare(b, 'en', { numeric: true }))
    .map(room => {
      const dayEntries = entries.filter(entry => entry.rooms.includes(room)).sort((a, b) =>
        a.start.localeCompare(b.start) || a.end.localeCompare(b.end) || a.group.localeCompare(b.group))
      const overlaps = dayEntries.filter(entry => overlapsInterval(entry, request.start, request.end))
      return { room, available: overlaps.length === 0, overlaps, dayEntries,
        nextStart: dayEntries.find(entry => entry.start >= request.end)?.start ?? null }
    })
}

export function unassignedBlocks(data: Dataset, request: RoomRequest): Entry[] {
  return data.entries.filter(entry => entry.weekday === request.weekday && entry.rooms.length === 0 && overlapsInterval(entry, request.start, request.end))
}
