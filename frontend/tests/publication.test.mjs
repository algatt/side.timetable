import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createHash } from 'node:crypto'
import { checkPublication } from '../scripts/check-publication.mjs'

async function fixture(t) {
  const folder = await mkdtemp(join(tmpdir(), 'timetable-publication-'))
  t.after(() => rm(folder, { recursive: true, force: true }))
  const root = pathToFileURL(`${folder}/`)
  const put = async (path, value) => {
    const target = new URL(path, root)
    await mkdir(new URL('./', target), { recursive: true })
    await writeFile(target, typeof value === 'object' ? JSON.stringify(value) : value)
  }
  const pdf = '%PDF-test timetable %%EOF', labs = '%PDF-test labs %%EOF'
  const hash = value => createHash('sha256').update(value).digest('hex')
  const data = {
    schema_version: 1, schedule_kind: 'weekly', timezone: 'Europe/Malta',
    validation_status: 'passed', generated_at: '2026-11-06T06:00:00Z',
    source: { sha256: hash(pdf), page_count: 1 },
    groups: [{ id: 'G', label: 'G' }], rooms: ['ICT-001'],
    schedule_coverage: { weekdays: ['Friday'], start: '08:00', end: '20:00' },
    entries: [{ id: 'a', group: 'G', weekday: 'Friday', start: '09:00', end: '10:00',
      duration_minutes: 60, subject_name: 'Computing', subject_code: null,
      entry_kind: 'lesson', code_status: 'missing', rooms: ['ICT-001'],
      notes: [], raw_text: 'Computing', source_page: 1 }],
    lab_inventory: { schema_version: 1, source: { sha256: hash(labs) }, room_count: 0, rooms: [] },
  }
  const validation = { status: 'passed', errors: [], source_pdf_sha256: hash(pdf), generated_at: data.generated_at }
  await put('frontend/dist/data/timetable.json', data)
  await put('frontend/dist/data/changes.json', { current: { sha: hash(pdf) } })
  await put('frontend/dist/data/iict-labs.pdf', labs)
  await put('frontend/dist/index.html', '<html>Test publication</html>')
  await put('frontend/dist/mascot.png', 'test mascot')
  await put('data/source/timetable.pdf', pdf)
  await put('data/source/metadata.json', { sha256: hash(pdf) })
  await put('data/processed/validation.json', validation)
  return { root, put, data, validation }
}

test('publication accepts a complete matching import', async t => {
  const { root, data } = await fixture(t)
  assert.deepEqual(await checkPublication(root), data)
})

test('publication rejects stale data after a new download and failed validation', async t => {
  const { root, put, validation } = await fixture(t)
  await put('data/processed/validation.json', { ...validation, status: 'failed', errors: ['Unreadable page'] })
  await assert.rejects(checkPublication(root), /successful import/)
  await put('data/processed/validation.json', validation)
  await put('data/source/timetable.pdf', '%PDF-new version %%EOF')
  await assert.rejects(checkPublication(root), /successful import/)
})

test('publication rejects stale comparisons, missing search hours and mismatched lab PDF', async t => {
  const { root, put, data } = await fixture(t)
  await put('frontend/dist/data/changes.json', { current: { sha: 'old import' } })
  await assert.rejects(checkPublication(root), /successful import/)
  await put('frontend/dist/data/changes.json', { current: { sha: data.source.sha256 } })
  await put('frontend/dist/data/timetable.json', { ...data, schedule_coverage: null })
  await assert.rejects(checkPublication(root), /search hours/)
  await put('frontend/dist/data/timetable.json', data)
  await put('frontend/dist/data/iict-labs.pdf', '%PDF-different labs %%EOF')
  await assert.rejects(checkPublication(root), /lab PDF/)
})
