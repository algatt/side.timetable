import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { assertDataset } from '../src/lib/timetable.ts'

// Check the actual files about to be deployed, not just their build inputs.
export async function checkPublication(root = new URL('../../', import.meta.url)) {
  const read = async path => JSON.parse(await readFile(new URL(path, root), 'utf8'))
  const data = await read('frontend/dist/data/timetable.json')
  const validation = await read('data/processed/validation.json')
  const metadata = await read('data/source/metadata.json')
  const changes = await read('frontend/dist/data/changes.json')
  const pdf = await readFile(new URL('data/source/timetable.pdf', root))
  const hash = createHash('sha256').update(pdf).digest('hex')
  assertDataset(data)
  if (hash !== metadata.sha256 || hash !== data.source.sha256 ||
      hash !== validation.source_pdf_sha256 || hash !== changes.current?.sha ||
      !['passed', 'passed_with_warnings'].includes(validation.status) ||
      !Array.isArray(validation.errors) || validation.errors.length ||
      data.generated_at !== validation.generated_at) {
    throw new Error('Published timetable, PDF, validation and comparison must match a successful import.')
  }
  if (!data.entries.length || !data.schedule_coverage || !data.rooms.some(room => room.startsWith('ICT-'))) {
    throw new Error('Publication requires lessons, published search hours and ICT rooms.')
  }
  if (!data.lab_inventory) throw new Error('Publication requires the supplied lab inventory.')
  const labs = await readFile(new URL('frontend/dist/data/iict-labs.pdf', root))
  if (createHash('sha256').update(labs).digest('hex') !== data.lab_inventory.source.sha256) {
    throw new Error('Published lab PDF does not match the inventory.')
  }
  for (const asset of ['frontend/dist/index.html', 'frontend/dist/mascot.png']) {
    if (!(await readFile(new URL(asset, root))).length) throw new Error(`Missing publication asset: ${asset}`)
  }
  return data
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const data = await checkPublication()
    console.log(`Publication verified: ${data.entries.length} entries, ${data.rooms.length} rooms.`)
  } catch (error) {
    console.error(`Publication rejected: ${error.message}`)
    process.exitCode = 1
  }
}
