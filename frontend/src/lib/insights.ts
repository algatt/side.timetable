import { toMinutes, WEEKDAYS } from './timetable.ts'
import type { Dataset, Entry, Weekday } from './timetable.ts'
import { findRooms } from './roomAvailability.ts'
import type { RoomRequest, RoomResult } from './roomAvailability.ts'

export function maltaNow(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Malta', weekday: 'long', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(date)
  return { weekday: parts.find(p => p.type === 'weekday')!.value as Weekday, time: `${parts.find(p => p.type === 'hour')!.value}:${parts.find(p => p.type === 'minute')!.value}` }
}
// Fraction of the displayed calendar range; never show a line on another day or outside it.
export function currentTimePosition(day: Weekday, range: {start:number;end:number}, date = new Date()): number | null {
  const local = maltaNow(date), minute = toMinutes(local.time)
  if (day !== local.weekday || range.end <= range.start || minute < range.start || minute >= range.end) return null
  return (minute - range.start) / (range.end - range.start)
}
export const clock = (minute: number) => `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`
export function liveRequest(data: Dataset, duration: number, date = new Date()): RoomRequest {
  const now = maltaNow(date), coverage = data.schedule_coverage
  if (!coverage || !coverage.weekdays.includes(now.weekday) || toMinutes(now.time) < toMinutes(coverage.start) || toMinutes(now.time) >= toMinutes(coverage.end)) throw new Error('The current Malta time is outside the published timetable days or hours.')
  if (!Number.isInteger(duration) || duration < 1) throw new Error('Choose a positive number of minutes.')
  if (toMinutes(now.time) + duration > toMinutes(coverage.end)) throw new Error(`Only ${toMinutes(coverage.end) - toMinutes(now.time)} published minutes remain today. Choose a shorter duration.`)
  return { weekday: now.weekday, start: now.time, end: clock(toMinutes(now.time) + duration), building: 'ICT', roomQuery: '' }
}
export interface LiveRoomResult extends RoomResult { freeUntil: string; availableMinutes: number; atClosing: boolean }
export function findLiveRooms(data: Dataset, duration: number, date = new Date()) {
  const request = liveRequest(data, duration, date)
  const rooms: LiveRoomResult[] = findRooms(data, request).filter(room => room.available).map(room => {
    const freeUntil = room.nextStart ?? data.schedule_coverage!.end
    return { ...room, freeUntil, availableMinutes: toMinutes(freeUntil) - toMinutes(request.start), atClosing: room.nextStart === null }
  }).sort((a,b) => b.availableMinutes - a.availableMinutes || a.room.localeCompare(b.room,'en',{numeric:true}))
  return {rooms, request}
}
export function occupiedMinutes(entries: Entry[], start: number, end: number): number {
  const intervals = entries.map(e => [Math.max(start, toMinutes(e.start)), Math.min(end, toMinutes(e.end))]).filter(([a,b]) => a < b).sort((a,b) => a[0] - b[0])
  let total = 0, cursor = start
  for (const [a,b] of intervals) { total += Math.max(0, b - Math.max(a,cursor)); cursor = Math.max(cursor,b) }
  return total
}
export function roomUsage(data: Dataset, days: Weekday[], start: string, end: string, kind = 'all') {
  const coverage = data.schedule_coverage
  if (!coverage || !days.length || days.some(day => !coverage.weekdays.includes(day)) || toMinutes(start) < toMinutes(coverage.start) || toMinutes(end) > toMinutes(coverage.end) || toMinutes(start) >= toMinutes(end)) throw new Error('Choose days and times within the published coverage.')
  const profiles = new Map(data.lab_inventory?.rooms.map(lab => [lab.room,lab]))
  const totalMinutes = (toMinutes(end) - toMinutes(start)) * days.length
  return data.rooms.filter(room => room.startsWith('ICT-') && (kind === 'all' || profiles.get(room)?.kind === kind)).map(room => {
    const byDay = days.map(day => ({ day, occupied: occupiedMinutes(data.entries.filter(e => e.weekday === day && e.rooms.includes(room)), toMinutes(start), toMinutes(end)) }))
    const occupied = byDay.reduce((sum,day) => sum + day.occupied, 0)
    return { room, occupied, totalMinutes, percent: occupied / totalMinutes * 100, byDay }
  }).sort((a,b) => b.percent - a.percent || a.room.localeCompare(b.room))
}
export function alternatives(data: Dataset, source: string, request: RoomRequest) {
  const profile = data.lab_inventory?.rooms.find(lab => lab.room === source)
  const requirements: string[] = []
  if (profile) {
    if (profile.seating_capacity !== null) requirements.push(`At least ${profile.seating_capacity} seats`)
    if (profile.student_pcs !== null) requirements.push(`At least ${profile.student_pcs} student PCs`)
    requirements.push(profile.os ?? 'OS not listed')
    for (const field of ['smartboard','tv_screen','projector'] as const) if (profile[field]) requirements.push(field.replace('_',' '))
  }
  const profiles = new Map(data.lab_inventory?.rooms.map(lab => [lab.room,lab]))
  const rooms = findRooms(data, { ...request, roomQuery: '', building: 'ICT' }).filter(result => {
    if (!result.available || result.room === source) return false
    if (!profile) return true
    const candidate = profiles.get(result.room)
    if (!candidate || candidate.kind !== profile.kind) return false
    if (profile.seating_capacity !== null && (candidate.seating_capacity === null || candidate.seating_capacity < profile.seating_capacity)) return false
    if (profile.student_pcs !== null && (candidate.student_pcs === null || candidate.student_pcs < profile.student_pcs)) return false
    for (const field of ['teacher_pc','smartboard','tv_screen','projector'] as const) if (profile[field] && !candidate[field]) return false
    const os = profile.os?.toLowerCase() ?? '', candidateOs = candidate.os?.toLowerCase() ?? ''
    for (const token of ['win','ubuntu','mac']) if (os.includes(token) && !candidateOs.includes(token)) return false
    return true
  })
  return { rooms, requirements, sourceNotes: profile?.notes ?? null }
}

export interface Change { kind: 'added' | 'removed' | 'changed'; before?: Entry; after?: Entry; fields: string[] }
const identity = (e: Entry) => JSON.stringify([e.group, e.subject_code && !e.subject_code.toLowerCase().includes('x') ? e.subject_code : `${e.subject_code ?? ''}:${e.subject_name.toLowerCase().trim()}`])
const core = (e: Entry) => JSON.stringify([identity(e), e.subject_name, e.weekday, e.start, e.end, [...e.rooms].sort()])
export function diffTimetables(before: Entry[], after: Entry[]): Change[] {
  const left = [...before], right = [...after], changes: Change[] = []
  // Cancel identical records as a multiset, ignoring PDF page and generated IDs.
  for (let i = left.length - 1; i >= 0; i--) { const j = right.findIndex(e => core(e) === core(left[i])); if (j !== -1) { left.splice(i,1); right.splice(j,1) } }
  const keys = new Set([...left,...right].map(identity))
  for (const key of keys) {
    const old = left.filter(e => identity(e) === key), next = right.filter(e => identity(e) === key)
    const pair = (a: Entry,b: Entry) => {
      const fields: string[] = []
      if (a.weekday !== b.weekday) fields.push('Day')
      if (a.start !== b.start || a.end !== b.end) fields.push('Time')
      if (JSON.stringify([...a.rooms].sort()) !== JSON.stringify([...b.rooms].sort())) fields.push('Rooms')
      if (a.subject_name !== b.subject_name) fields.push('Subject name')
      changes.push({ kind: 'changed', before: a, after: b, fields }); old.splice(old.indexOf(a),1); next.splice(next.indexOf(b),1)
    }
    // Only pair moves when the relationship is unambiguous in both directions.
    for (const anchor of [(e:Entry) => `${e.weekday}:${e.start}:${e.end}`, (e:Entry) => `${e.weekday}:${[...e.rooms].sort()}`, (e:Entry) => `${e.start}:${e.end}:${[...e.rooms].sort()}`]) {
      for (const a of [...old]) { const matches = next.filter(b => anchor(a) === anchor(b)); if (matches.length === 1 && old.filter(o => anchor(o) === anchor(matches[0])).length === 1) pair(a,matches[0]) }
    }
    if (old.length === 1 && next.length === 1) pair(old[0],next[0])
    changes.push(...old.map(before => ({kind:'removed' as const,before,fields:[]})), ...next.map(after => ({kind:'added' as const,after,fields:[]})))
  }
  return changes.sort((a,b) => (a.after ?? a.before)!.group.localeCompare((b.after ?? b.before)!.group))
}
