import { readFile, mkdir, writeFile, rename, copyFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { assertDataset } from '../src/lib/timetable.ts'
import { recordHistory } from './history.mjs'

const root = new URL('../../', import.meta.url)
try {
  const data = JSON.parse(await readFile(new URL('data/processed/timetable.json', root), 'utf8'))
  const validation = JSON.parse(await readFile(new URL('data/processed/validation.json', root), 'utf8'))
  assertDataset(data)
  if (validation.status === 'failed' || !Array.isArray(validation.errors) || validation.errors.length ||
      validation.source_pdf_sha256 !== data.source.sha256 || validation.generated_at !== data.generated_at) {
    throw new Error('The dataset and validation report must belong to the same successful extraction.')
  }
  const folder = new URL('../public/data/', import.meta.url)
  await mkdir(folder, { recursive: true })
  const labsPdf = new URL('data/IICT Labs.pdf', root)
  if (existsSync(labsPdf)) {
    const inventory = JSON.parse(await readFile(new URL('data/processed/labs.json', root), 'utf8'))
    const hash = createHash('sha256').update(await readFile(labsPdf)).digest('hex')
    if (inventory.source.sha256 !== hash) throw new Error('Lab PDF changed. Run .venv/bin/python -m backend.extract_labs first.')
    data.lab_inventory = inventory
    assertDataset(data)
    await copyFile(labsPdf, new URL('iict-labs.pdf', folder))
  }
  const temporary = new URL('timetable.json.tmp', folder)
  const changes = await recordHistory(data, fileURLToPath(new URL('data/history/', root)))
  await writeFile(new URL('changes.json.tmp', folder), JSON.stringify(changes))
  await rename(new URL('changes.json.tmp', folder), new URL('changes.json', folder))
  await writeFile(temporary, JSON.stringify(data))
  await rename(temporary, new URL('timetable.json', folder))
  console.log(`Prepared ${data.entries.length} timetable entries for the viewer.`)
} catch (error) {
  console.error(`Cannot prepare timetable data: ${error.message}`)
  console.error(`Run .venv/bin/python -m backend.extract_timetable from ${fileURLToPath(root)} first.`)
  process.exitCode = 1
}
