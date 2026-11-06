export type LabKind = 'computer_lab' | 'classroom' | 'other'
export interface Lab {
  room: string
  location: string
  kind: LabKind
  seating_capacity: number | null
  student_pcs: number | null
  teacher_pc: true | null
  smartboard: true | null
  tv_screen: true | null
  projector: true | null
  os: string | null
  notes: string | null
  source_page: number
}
export interface LabInventory {
  schema_version: number
  source: { filename: string; sha256: string; page_count: number }
  room_count: number
  rooms: Lab[]
}
export interface LabFilters {
  minimumSeats: number | null
  minimumStudentPcs: number | null
  kind: 'all' | LabKind
  os: 'all' | 'windows' | 'ubuntu' | 'macos'
  display: 'all' | 'smartboard' | 'tv_screen' | 'projector'
}
export const KIND_LABELS = { computer_lab: 'Computer lab', classroom: 'Classroom', other: 'Other room' }
export const emptyLabFilters = (): LabFilters => ({ minimumSeats: null, minimumStudentPcs: null, kind: 'all', os: 'all', display: 'all' })
export function hasLabFilters(filters: LabFilters): boolean {
  return filters.minimumSeats !== null || filters.minimumStudentPcs !== null || filters.kind !== 'all' || filters.os !== 'all' || filters.display !== 'all'
}
export function labFilterError(filters: LabFilters): string | null {
  for (const value of [filters.minimumSeats, filters.minimumStudentPcs]) {
    if (value !== null && (!Number.isInteger(value) || value < 0 || value > 10000)) return 'Enter a whole number of seats or PCs between 0 and 10000.'
  }
  if (!['all', ...Object.keys(KIND_LABELS)].includes(filters.kind) || !['all', 'windows', 'ubuntu', 'macos'].includes(filters.os) ||
      !['all', 'smartboard', 'tv_screen', 'projector'].includes(filters.display)) return 'Choose one of the listed lab filters.'
  return null
}
export function matchesLab(lab: Lab | undefined, filters: LabFilters): boolean {
  if (!hasLabFilters(filters)) return true
  if (!lab || labFilterError(filters)) return false
  if (filters.minimumSeats !== null && (lab.seating_capacity === null || lab.seating_capacity < filters.minimumSeats)) return false
  if (filters.minimumStudentPcs !== null && (lab.student_pcs === null || lab.student_pcs < filters.minimumStudentPcs)) return false
  if (filters.kind !== 'all' && lab.kind !== filters.kind) return false
  const os = lab.os?.toLowerCase() ?? ''
  if (filters.os === 'windows' && !os.includes('win')) return false
  if (filters.os === 'ubuntu' && !os.includes('ubuntu')) return false
  if (filters.os === 'macos' && !os.includes('mac')) return false
  if (filters.display !== 'all' && lab[filters.display] !== true) return false
  return true
}
export function assertLabInventory(value: unknown): asserts value is LabInventory {
  const inventory = value as LabInventory
  if (!inventory || inventory.schema_version !== 1 || !Array.isArray(inventory.rooms) || inventory.room_count !== inventory.rooms.length ||
      !inventory.source || !/^[a-f0-9]{64}$/.test(inventory.source.sha256)) throw new Error('Invalid lab inventory.')
  const ids = new Set<string>()
  for (const lab of inventory.rooms) {
    if (!/^ICT-[A-Z]?\d{2,3}$/.test(lab.room) || ids.has(lab.room) || !Object.hasOwn(KIND_LABELS, lab.kind) ||
        !Number.isInteger(lab.source_page) || lab.source_page < 1 || lab.source_page > inventory.source.page_count ||
        ![lab.seating_capacity, lab.student_pcs].every(v => v === null || (Number.isInteger(v) && v >= 0)) ||
        ![lab.teacher_pc, lab.smartboard, lab.tv_screen, lab.projector].every(v => v === true || v === null) ||
        ![lab.os, lab.notes].every(v => v === null || typeof v === 'string')) throw new Error('Invalid lab inventory room.')
    ids.add(lab.room)
  }
}
export function labFiltersFromParams(params: URLSearchParams): LabFilters {
  const filters = emptyLabFilters()
  for (const [field, parameter] of [['minimumSeats', 'seats'], ['minimumStudentPcs', 'pcs']] as const) {
    const value = params.get(parameter)
    if (value !== null && value !== '') filters[field] = Number(value)
  }
  for (const [field, parameter] of [['kind', 'type'], ['os', 'os'], ['display', 'display']] as const) {
    if (params.has(parameter)) (filters as unknown as Record<string, unknown>)[field] = params.get(parameter)
  }
  return filters
}
export function writeLabFilterParams(params: URLSearchParams, filters: LabFilters) {
  for (const [field, parameter] of [['minimumSeats', 'seats'], ['minimumStudentPcs', 'pcs'], ['kind', 'type'], ['os', 'os'], ['display', 'display']] as const) {
    const value = filters[field]
    if (value === null || value === 'all') params.delete(parameter)
    else params.set(parameter, String(value))
  }
}
