import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { assertDataset, entriesForGroup, entriesForRoom, scheduleRooms, hasSourceNote, layoutDay, sourceUrl, subjectTone, timeRange, toMinutes } from '../src/lib/timetable.ts'

function entry(id, start, end, extra = {}) {
  return { id, start, end, weekday: 'Wednesday', group: 'General', subject_name: 'Student Support', subject_code: null, rooms: [], ...extra }
}

test('parallel blocks get separate lanes and touching blocks reuse a lane', () => {
  const result = layoutDay([entry('a', '08:00', '10:00'), entry('b', '09:00', '11:00'), entry('c', '11:00', '12:00')])
  assert.deepEqual(result.map(item => [item.entry.id, item.lane, item.lanes]), [['a', 0, 2], ['b', 1, 2], ['c', 0, 1]])
})

test('nested and chained overlaps never cover each other in a lane', () => {
  const result = layoutDay([entry('d', '09:30', '11:00'), entry('c', '09:00', '10:00'), entry('b', '08:30', '09:00'), entry('a', '08:00', '12:00')])
  assert.equal(result.length, 4)
  assert.equal(Math.max(...result.map(item => item.lanes)), 3)
  for (const a of result) for (const b of result) {
    if (a.entry.id !== b.entry.id && a.lane === b.lane) {
      assert.ok(a.entry.start >= b.entry.end || b.entry.start >= a.entry.end)
    }
  }
})

test('calendar range includes early and evening blocks', () => {
  assert.deepEqual(timeRange([]), { start: 480, end: 960 })
  assert.deepEqual(timeRange([entry('a', '07:30', '19:30')]), { start: 420, end: 1200 })
  for (const time of ['8:00', '24:00', '12:60', 'bad']) assert.throws(() => toMinutes(time))
})

test('PDF links preserve page references and reject executable protocols', () => {
  assert.equal(sourceUrl('https://iict.mcast.edu.mt/timetable.pdf', 4), 'https://iict.mcast.edu.mt/timetable.pdf#page=4')
  assert.equal(sourceUrl('javascript:alert(1)'), undefined)
  assert.equal(sourceUrl(null), undefined)
})

test('missing or placeholder source details remain visible', () => {
  assert.equal(hasSourceNote(entry('a', '08:00', '09:00', { code_status: 'missing', rooms: ['ICT-140'] })), true)
  assert.equal(hasSourceNote(entry('a', '08:00', '09:00', { code_status: 'placeholder', rooms: ['ICT-140'] })), true)
  assert.equal(hasSourceNote(entry('a', '08:00', '09:00', { code_status: 'complete', rooms: ['ICT-126', 'ICT-142'] })), false)
})

test('subject colours remain stable across rooms and groups', () => {
  const a = entry('a', '08:00', '09:00', { subject_name: 'Computer Systems', subject_code: 'ITSYS-206-2002' })
  assert.equal(subjectTone(a), subjectTone({ ...a, id: 'b', rooms: ['ICT-100'], group: 'B' }))
})

const dataPath = new URL('../../data/processed/timetable.json', import.meta.url)
test('real extracted data validates and every group block has a non-overlapping calendar lane', { skip: !existsSync(dataPath) }, () => {
  const data = JSON.parse(readFileSync(dataPath, 'utf8'))
  assertDataset(data)
  for (const group of data.groups) {
    const entries = entriesForGroup(data, group.id)
    assert.equal(entries.length, group.entry_count)
    for (const day of new Set(entries.map(entry => entry.weekday))) {
      const layout = layoutDay(entries.filter(entry => entry.weekday === day))
      assert.equal(layout.length, entries.filter(entry => entry.weekday === day).length)
      for (const a of layout) for (const b of layout) {
        if (a.entry.id !== b.entry.id && a.lane === b.lane) assert.ok(a.entry.start >= b.entry.end || b.entry.start >= a.entry.end)
      }
    }
  }
  const fit = entriesForGroup(data, 'IT-FIT-2.1A')
  if (data.source.sha256 === '736f4378e3bb736b9d03781e540fadf7995b4467eef7cb7a260c6809d9c6fa93') {
    assert.equal(fit.length, 17)
    assert.deepEqual(fit.find(entry => entry.weekday === 'Friday' && entry.start === '08:00').rooms, ['ICT-126', 'ICT-142'])
  }
  const corrupt = structuredClone(data)
  corrupt.entries[0].duration_minutes = -1
  assert.throws(() => assertDataset(corrupt))
  const duplicate = structuredClone(data)
  duplicate.entries.push(duplicate.entries[0])
  assert.throws(() => assertDataset(duplicate))
})

 test('room schedules include all groups and every room of a multi-room lesson', () => {
  const multi = {id: 'a', group: 'A', weekday: 'Friday', start: '08:00', rooms: ['ICT-126', 'ICT-142']}
  const later = {id: 'b', group: 'B', weekday: 'Friday', start: '09:30', rooms: ['ICT-142']}
  const data = {rooms: ['ICT-126', 'ICT-142', 'IBMC-018'], entries: [later, multi], lab_inventory: {rooms: [{room: 'ICT-002'}]}}
  assert.deepEqual(entriesForRoom(data, 'ICT-126').map(e=>e.id), ['a'])
  assert.deepEqual(entriesForRoom(data, 'ICT-142').map(e=>e.id), ['a', 'b'])
  assert.deepEqual(entriesForRoom(data, 'ICT-002'), [])
  assert.deepEqual(scheduleRooms(data), ['ICT-002', 'ICT-126', 'ICT-142'])
})
