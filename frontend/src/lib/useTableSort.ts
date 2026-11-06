import { ref } from 'vue'
import type { SortDirection } from './tableSort'
export function useTableSort(initialKey: string, initialDirection: SortDirection = 'asc') {
  const key=ref(initialKey), direction=ref<SortDirection>(initialDirection)
  function toggle(column: string) { if(key.value===column) direction.value=direction.value==='asc'?'desc':'asc'; else { key.value=column; direction.value='asc' } }
  return {key,direction,toggle}
}
