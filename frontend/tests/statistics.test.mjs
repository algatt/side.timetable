import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { timetableStatistics, unitIdentity } from '../src/lib/statistics.ts'

const entry = (overrides = {}) => ({
  id: 'a', group: 'G1', entry_kind: 'lesson', weekday: 'Friday',
  subject_name: 'Databases', subject_code: 'DB1', code_status: 'complete',
  duration_minutes: 90, rooms: ['ICT-126', 'ICT-142'], ...overrides,
})

test('multiple rooms do not multiply lesson hours and shared groups retain their own hours', () => {
  const entries = [entry(), entry({ id: 'b', group: 'G2' }), entry({ id: 'c', weekday: 'Monday', duration_minutes: 60 })]
  const original = structuredClone(entries)
  const stats = timetableStatistics(entries)
  assert.equal(stats.minutes, 240)
  assert.equal(stats.lessons, 3)
  assert.equal(stats.units.length, 1)
  assert.deepEqual(stats.units[0].groups, ['G1', 'G2'])
  assert.deepEqual(stats.units[0].days, ['Monday', 'Friday'])
  assert.deepEqual(stats.groups.map(row => [row.id, row.minutes, row.lessons, row.units]), [['G1', 150, 2, 1], ['G2', 90, 1, 1]])
  assert.deepEqual(entries, original)
})

test('missing and placeholder codes never merge unrelated units; different codes keep names apart', () => {
  const entries = [
    entry({ subject_code: null, code_status: 'missing' }),
    entry({ id: 'b', subject_code: null, code_status: 'missing', subject_name: 'Networking' }),
    entry({ id: 'c', subject_code: 'IT-xx', code_status: 'placeholder' }),
    entry({ id: 'd', subject_code: 'IT-xx', code_status: 'placeholder', subject_name: 'Networking' }),
    entry({ id: 'e', subject_code: 'DB2' }),
    entry({ id: 'f', subject_code: 'DB2', subject_name: '  DATABASES  ' }),
  ]
  const stats = timetableStatistics(entries)
  assert.equal(stats.units.length, 5)
  assert.equal(stats.groups[0].units, 5)
  assert.equal(stats.units.find(unit => unit.code === 'DB2').lessons, 2)
  assert.equal(stats.units.filter(unit => unit.codeStatus === 'placeholder').length, 2)
})

test('complete codes combine printed-name variants while retaining every source name', () => {
  const stats = timetableStatistics([
    entry(), entry({ id: 'b', group: 'G2', subject_name: 'G1, G2 -Databases' }),
    entry({ id: 'c', subject_code: 'DB2' }),
  ])
  assert.equal(stats.units.length, 2)
  const unit = stats.units.find(unit => unit.code === 'DB1')
  assert.equal(unit.name, 'Databases')
  assert.deepEqual(unit.names, ['Databases', 'G1, G2 -Databases'])
  assert.equal(unit.minutes, 180)
  assert.deepEqual(unit.groups, ['G1', 'G2'])
})

test('activities are excluded without losing named lessons that have no printed code or room', () => {
  const stats = timetableStatistics([
    entry({ subject_code: null, code_status: 'missing', rooms: [] }),
    entry({ id: 'b', entry_kind: 'activity', group: 'Meetings', duration_minutes: 120 }),
  ])
  assert.equal(stats.minutes, 90)
  assert.equal(stats.lessons, 1)
  assert.equal(stats.excludedActivities, 1)
  assert.deepEqual(stats.groups.map(group => group.id), ['G1'])
  assert.deepEqual(timetableStatistics([]), { units: [], groups: [], lessons: 0, minutes: 0, days: [], excludedActivities: 0 })
})

test('group and unit totals reconcile, including overlapping lesson blocks', () => {
  const entries = [entry(), entry({ id: 'b', subject_code: 'AI1', subject_name: 'AI', duration_minutes: 60 })]
  const stats = timetableStatistics(entries)
  assert.equal(stats.groups[0].minutes, 150)
  assert.equal(stats.units.reduce((sum, unit) => sum + unit.minutes, 0), stats.minutes)
  assert.equal(stats.groups.reduce((sum, group) => sum + group.lessons, 0), stats.lessons)
  const groupDetail = timetableStatistics(entries.filter(item => item.group === stats.groups[0].id))
  assert.equal(groupDetail.units.reduce((sum, unit) => sum + unit.minutes, 0), stats.groups[0].minutes)
  const unitDetail = timetableStatistics(entries.filter(item => unitIdentity(item) === stats.units[0].id))
  assert.equal(unitDetail.groups.reduce((sum, group) => sum + group.minutes, 0), stats.units[0].minutes)
})

const path = new URL('../../data/processed/timetable.json', import.meta.url)
test('complete published dataset reconciles across both views and FIT retains its verified weekly hours', { skip: !existsSync(path) }, () => {
  const data = JSON.parse(readFileSync(path, 'utf8'))
  const stats = timetableStatistics(data.entries)
  const lessons = data.entries.filter(entry => entry.entry_kind === 'lesson')
  assert.equal(stats.lessons, lessons.length)
  assert.equal(stats.minutes, lessons.reduce((sum, entry) => sum + entry.duration_minutes, 0))
  assert.equal(stats.units.reduce((sum, unit) => sum + unit.minutes, 0), stats.minutes)
  assert.equal(stats.groups.reduce((sum, group) => sum + group.minutes, 0), stats.minutes)
  if (data.source.sha256 === '736f4378e3bb736b9d03781e540fadf7995b4467eef7cb7a260c6809d9c6fa93') {
    const fit = stats.groups.find(group => group.id === 'IT-FIT-2.1A')
    assert.equal(fit.minutes, 1200)
    assert.equal(fit.lessons, 17)
    assert.equal(stats.excludedActivities, 11)
    const visualisation = stats.units.find(unit => unit.code === 'ITADS-506-2305')
    assert.equal(visualisation.minutes, 180)
    assert.equal(visualisation.names.length, 2)
    const maths = stats.units.find(unit => unit.code === 'ITMTH-506-2303')
    assert.equal(maths.name, 'Maths for Cybersecurity')
    assert.deepEqual(maths.groups, ['Erasmus Group 1', 'IT-CYB-6.2A'])
    assert.equal(maths.minutes, 360)
    assert.equal(maths.lessons, 4)
    const mathsEntries = data.entries.filter(entry => entry.subject_code === 'ITMTH-506-2303')
    assert.ok(mathsEntries.every(entry => entry.shared_groups.join('|') === 'IT-CYB-6.2A|Erasmus Group 1'))
  }
})
