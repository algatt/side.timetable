import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { findRooms, unassignedBlocks, validateRoomRequest } from '../src/lib/roomAvailability.ts'
import { assertDataset, toMinutes } from '../src/lib/timetable.ts'

function entry(id, room, start, end, extra = {}) {
  return { id, rooms: Array.isArray(room) ? room : [room], start, end, weekday: 'Friday', group: `Group ${id}`, ...extra }
}
function dataset(entries = [], rooms = ['ICT-126', 'ICT-142']) {
  return { rooms, entries, schedule_coverage: { weekdays: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'], start: '08:00', end: '20:00' } }
}
const request = (extra = {}) => ({ weekday: 'Friday', start: '09:30', end: '10:00', building: 'all', roomQuery: '', ...extra })

test('bookings touching either boundary leave the search interval free', () => {
  const results = findRooms(dataset([entry('a', 'ICT-126', '08:00', '09:30'), entry('b', 'ICT-142', '10:00', '11:00')]), request())
  assert.ok(results.every(result => result.available))
  assert.equal(results.find(result => result.room === 'ICT-142').nextStart, '10:00')
})

test('any partial, contained or enclosing overlap blocks a room', () => {
  const cases = [['09:00', '09:31'], ['09:59', '10:30'], ['09:40', '09:50'], ['08:00', '12:00'], ['09:30', '10:00']]
  for (const [start, end] of cases) {
    const [room] = findRooms(dataset([entry('a', 'ICT-126', start, end)], ['ICT-126']), request())
    assert.equal(room.available, false, `${start}–${end}`)
  }
})

test('every room in a multi-room block is blocked for its full duration', () => {
  const results = findRooms(dataset([entry('fit', ['ICT-126', 'ICT-142'], '08:00', '09:30')]), request({ start: '08:00', end: '09:30' }))
  assert.deepEqual(results.map(result => [result.room, result.available]), [['ICT-126', false], ['ICT-142', false]])
  assert.ok(results.every(result => result.overlaps[0].id === 'fit'))
})

test('bookings from other groups and coincident sessions are all considered', () => {
  const results = findRooms(dataset([entry('a', 'ICT-126', '09:30', '10:00'), entry('b', 'ICT-126', '09:30', '10:00')]), request())
  assert.equal(results.find(result => result.room === 'ICT-126').overlaps.length, 2)
  assert.equal(results.find(result => result.room === 'ICT-142').available, true)
})

test('bookings on a different weekday do not block this weekday', () => {
  const results = findRooms(dataset([entry('a', 'ICT-126', '09:30', '10:00', { weekday: 'Monday' })]), request())
  assert.ok(results.every(result => result.available))
})

test('ICT-only searches cannot include IBMC through filters or legacy all-building links', () => {
  const data = dataset([], ['ICT-126', 'IBMC-018'])
  assert.deepEqual(findRooms(data, request({ building: 'ICT' })).map(result => result.room), ['ICT-126'])
  assert.deepEqual(findRooms(data, request()).map(result => result.room), ['ICT-126'])
  assert.deepEqual(findRooms(data, request({ roomQuery: 'ibmc 018' })), [])
  assert.throws(() => findRooms(data, request({ building: 'IBMC' })))
  assert.equal(findRooms(data, request({ roomQuery: 'does-not-exist' })).length, 0)
})

test('invalid, reversed and unsupported search intervals are rejected', () => {
  const data = dataset()
  for (const changes of [{ start: '10:00', end: '09:00' }, { start: '09:30', end: '09:30' }, { start: '' },
    { start: '07:59' }, { end: '20:01' }, { weekday: 'Sunday' }, { building: 'UNKNOWN' }]) {
    assert.ok(validateRoomRequest(data, request(changes)))
    assert.throws(() => findRooms(data, request(changes)))
  }
  assert.ok(validateRoomRequest({ ...data, schedule_coverage: null }, request()))
})

test('arbitrary minute intervals are supported, not just half-hour slots', () => {
  const data = dataset([entry('a', 'ICT-126', '09:30', '10:00')])
  assert.equal(findRooms(data, request({ start: '09:17', end: '09:31' }))[0].available, false)
  assert.equal(findRooms(data, request({ start: '09:17', end: '09:30' }))[0].available, true)
})

test('unassigned blocks remain visible without inventing room assignments', () => {
  const data = dataset([entry('support', [], '09:00', '11:00'), entry('later', [], '12:00', '13:00')])
  assert.deepEqual(unassignedBlocks(data, request()).map(entry => entry.id), ['support'])
  assert.ok(findRooms(data, request()).every(result => result.available))
})

const dataPath = new URL('../../data/processed/timetable.json', import.meta.url)
test('real room results agree with an independent overlap calculation for every published weekday', { skip: !existsSync(dataPath) }, () => {
  const data = JSON.parse(readFileSync(dataPath, 'utf8'))
  assertDataset(data)
  assert.ok(data.schedule_coverage)
  for (const weekday of data.schedule_coverage.weekdays) {
    const { start: opening, end: closing } = data.schedule_coverage
    const intervals = [[opening, closing], ...[['08:00', '09:30'], ['09:30', '10:00'], ['11:15', '12:45'], ['17:00', '19:00']]
      .filter(([start, end]) => start >= opening && end <= closing)]
    for (const [start, end] of intervals) {
      const results = findRooms(data, request({ weekday, start, end }))
      assert.equal(results.length, data.rooms.filter(room => room.startsWith('ICT-')).length)
      for (const result of results) {
        const expectedBusy = data.entries.some(entry => entry.weekday === weekday && entry.rooms.includes(result.room) &&
          Math.max(toMinutes(entry.start), toMinutes(start)) < Math.min(toMinutes(entry.end), toMinutes(end)))
        assert.equal(result.available, !expectedBusy, `${weekday} ${start} ${result.room}`)
      }
    }
  }
})

test('FIT multi-room booking and the following group are both respected in the real source', { skip: !existsSync(dataPath) }, () => {
  const data = JSON.parse(readFileSync(dataPath, 'utf8'))
  if (data.source.sha256 !== '736f4378e3bb736b9d03781e540fadf7995b4467eef7cb7a260c6809d9c6fa93') return
  const during = findRooms(data, request({ start: '08:00', end: '09:30', roomQuery: '126' }))
  assert.equal(during[0].available, false)
  assert.ok(during[0].overlaps.some(entry => entry.group === 'IT-FIT-2.1A'))
  const after = findRooms(data, request({ start: '09:30', end: '10:00' }))
  assert.equal(after.find(result => result.room === 'ICT-126').available, true)
  assert.equal(after.find(result => result.room === 'ICT-142').available, false)
  assert.ok(after.find(result => result.room === 'ICT-142').overlaps.some(entry => entry.group === 'IT-FIT-2.1H'))
})
