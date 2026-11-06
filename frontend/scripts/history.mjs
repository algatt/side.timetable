import { mkdir, readFile, writeFile, rename } from 'node:fs/promises'
import { diffTimetables } from '../src/lib/insights.ts'

async function atomic(path, data) { await writeFile(`${path}.tmp`, JSON.stringify(data)); await rename(`${path}.tmp`, path) }
async function optional(path) { try { return JSON.parse(await readFile(path, 'utf8')) } catch (error) { if (error.code === 'ENOENT') return null; throw error } }
export async function recordHistory(data, folder) {
  if (!['passed','passed_with_warnings'].includes(data.validation_status) || !/^[a-f0-9]{64}$/.test(data.source.sha256)) throw new Error('Only validated imports can enter history.')
  await mkdir(folder, {recursive:true})
  const index = await optional(`${folder}/index.json`) ?? { versions: [] }
  const hash = data.source.sha256
  if (index.versions.at(-1)?.sha !== hash) {
    if (!await optional(`${folder}/${hash}.json`)) await atomic(`${folder}/${hash}.json`, { source: data.source, generated_at: data.generated_at, entries: data.entries })
    index.versions.push({sha:hash, imported_at:data.generated_at})
    await atomic(`${folder}/index.json`, index)
  }
  const previousRef = index.versions.at(-2)
  const previous = previousRef ? await optional(`${folder}/${previousRef.sha}.json`) : null
  if (previousRef && !previous) throw new Error('Previous history snapshot is missing; cannot compare imports.')
  return { schema_version:1, baseline:!previous, current: {sha:hash, imported_at:index.versions.at(-1).imported_at},
    previous: previousRef ?? null, changes: previous ? diffTimetables(previous.entries,data.entries) : [] }
}
