import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { assertLabInventory, emptyLabFilters, matchesLab, labFilterError, labFiltersFromParams, writeLabFilterParams } from '../src/lib/labs.ts'
import { findRooms } from '../src/lib/roomAvailability.ts'

const path = new URL('../../data/processed/labs.json', import.meta.url)
const timetablePath = new URL('../../data/processed/timetable.json', import.meta.url)
const available = existsSync(path) && existsSync(timetablePath)

test('lab filter URL settings round trip without inventing defaults', () => {
  const filters = { ...emptyLabFilters(), minimumSeats: 25, minimumStudentPcs: 20, os: 'ubuntu', display: 'projector' }
  const params = new URLSearchParams('tool=rooms&building=ICT')
  writeLabFilterParams(params, filters)
  assert.deepEqual(labFiltersFromParams(params), filters)
  writeLabFilterParams(params, emptyLabFilters())
  assert.equal(params.toString(), 'tool=rooms&building=ICT')
  assert.ok(labFilterError({ ...filters, minimumSeats: -1 }))
  assert.ok(labFilterError({ ...filters, minimumStudentPcs: 2.5 }))
})

test('blank equipment and PC counts are unknown rather than inferred from notes', { skip: !available }, () => {
  const inventory = JSON.parse(readFileSync(path, 'utf8'))
  assertLabInventory(inventory)
  const pi = inventory.rooms.find(room => room.room === 'ICT-300')
  assert.equal(pi.student_pcs, null)
  assert.equal(pi.notes, 'Raspberry Pi Lab (x30)')
  assert.equal(matchesLab(pi, { ...emptyLabFilters(), minimumStudentPcs: 30 }), false)
  assert.equal(pi.tv_screen, true)
  assert.equal(pi.projector, null)
  assert.equal(matchesLab(pi, { ...emptyLabFilters(), display: 'projector' }), false)
})

test('seating, PCs, OS, type and display filters use independent PDF columns', { skip: !available }, () => {
  const inventory = JSON.parse(readFileSync(path, 'utf8'))
  const network = inventory.rooms.find(room => room.room === 'ICT-003')
  assert.equal(matchesLab(network, { ...emptyLabFilters(), minimumSeats: 31, minimumStudentPcs: 20, os: 'ubuntu', display: 'tv_screen', kind: 'computer_lab' }), true)
  assert.equal(matchesLab(network, { ...emptyLabFilters(), minimumStudentPcs: 21 }), false)
  assert.equal(matchesLab(network, { ...emptyLabFilters(), display: 'smartboard' }), false)
  const study = inventory.rooms.find(room => room.room === 'ICT-109')
  assert.equal(matchesLab(study, { ...emptyLabFilters(), os: 'ubuntu' }), true)
  assert.equal(matchesLab(study, { ...emptyLabFilters(), os: 'windows' }), true)
})

test('inventory-only rooms do not become assumed-free timetable rooms', { skip: !available }, () => {
  const data = JSON.parse(readFileSync(timetablePath, 'utf8'))
  data.lab_inventory = JSON.parse(readFileSync(path, 'utf8'))
  const coverage = data.schedule_coverage
  const result = findRooms(data, { weekday: coverage.weekdays[0], start: coverage.start, end: coverage.end, building: 'all', roomQuery: '' })
  const inventoryOnly = data.lab_inventory.rooms.filter(lab => !data.rooms.includes(lab.room))
  assert.ok(inventoryOnly.every(lab => !result.some(room => room.room === lab.room)))
  assert.equal(result.some(room => room.room.startsWith('IBMC-')), false)
  assert.equal(result.length, data.rooms.filter(room => room.startsWith('ICT-')).length)
})

test('lab requirements and booking overlaps both apply to free-room searches', { skip: !available }, () => {
  const data = JSON.parse(readFileSync(timetablePath, 'utf8'))
  data.lab_inventory = JSON.parse(readFileSync(path, 'utf8'))
  const coverage = data.schedule_coverage
  const request = { weekday: coverage.weekdays[0], start: coverage.start, end: coverage.end, building: 'ICT', roomQuery: '', labFilters: { ...emptyLabFilters(), minimumSeats: 25, minimumStudentPcs: 20 } }
  const result = findRooms(data, request)
  for (const room of result) {
    const profile = data.lab_inventory.rooms.find(lab => lab.room === room.room)
    assert.ok(profile.seating_capacity >= 25 && profile.student_pcs >= 20)
  }
  if (data.source.sha256 === '736f4378e3bb736b9d03781e540fadf7995b4467eef7cb7a260c6809d9c6fa93') {
    const knownRequest = { ...request, weekday: 'Friday', start: '08:00', end: '09:30', roomQuery: '126' }
    const hardware = findRooms(data, { ...knownRequest, labFilters: emptyLabFilters() })
    assert.equal(hardware[0].available, false)
    assert.equal(findRooms(data, knownRequest).length, 0)
  }
})
