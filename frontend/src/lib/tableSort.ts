export type SortValue = string | number | null | undefined
export type SortDirection = 'asc' | 'desc'
const collator = new Intl.Collator('en', {numeric:true,sensitivity:'base'})
const missing = (value: SortValue) => value === null || value === undefined || value === '' || (typeof value === 'number' && !Number.isFinite(value))
export function sortRows<T>(rows: readonly T[], value: (row:T)=>SortValue, direction: SortDirection, identity: (row:T)=>string): T[] {
  return [...rows].sort((a,b) => {
    const left=value(a), right=value(b)
    if (missing(left) !== missing(right)) return missing(left) ? 1 : -1
    const compared=missing(left) ? 0 : typeof left==='number' && typeof right==='number' ? left-right : collator.compare(String(left),String(right))
    return compared * (direction==='asc'?1:-1) || collator.compare(identity(a),identity(b))
  })
}
