<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { Dataset } from '../lib/timetable'
import { lessonHours, timetableStatistics, unitIdentity } from '../lib/statistics'
import type { GroupStatistics, UnitStatistics } from '../lib/statistics'
import { sortRows } from '../lib/tableSort'
import { useTableSort } from '../lib/useTableSort'
import SortHeader from './SortHeader.vue'
import AppIcon from './AppIcon.vue'
import ScheduledDays from './ScheduledDays.vue'

const props = defineProps<{ data: Dataset }>()
const view = ref<'unit' | 'group'>(new URLSearchParams(location.search).get('stats_by') === 'group' ? 'group' : 'unit')
const query = ref('')
const expanded = ref<string | null>(null)
const sorting = useTableSort('hours', 'desc')
const statistics = computed(() => timetableStatistics(props.data.entries))
const units = computed(() => sortRows(statistics.value.units.filter(row =>
  `${row.name} ${row.code ?? ''}`.toLowerCase().includes(query.value.trim().toLowerCase())),
  row => sortValue(row), sorting.direction.value, row => `${row.code ?? ''} ${row.name}`))
const groups = computed(() => sortRows(statistics.value.groups.filter(row =>
  row.id.toLowerCase().includes(query.value.trim().toLowerCase())),
  row => sortValue(row), sorting.direction.value, row => row.id))
const matching = computed(() => view.value === 'unit' ? units.value.length : groups.value.length)
const detail = computed(() => {
  const entries = props.data.entries.filter(entry => view.value === 'unit' ? unitIdentity(entry) === expanded.value : entry.group === expanded.value)
  return timetableStatistics(entries)
})
const detailUnits = computed(() => sortRows(detail.value.units, row => row.minutes, 'desc', row => `${row.code ?? ''} ${row.name}`))
const detailGroups = computed(() => sortRows(detail.value.groups, row => row.minutes, 'desc', row => row.id))

function sortValue(row: UnitStatistics | GroupStatistics) {
  switch (sorting.key.value) {
    case 'name': return 'name' in row ? row.name : row.id
    case 'code': return 'code' in row ? row.code : null
    case 'count': return 'groups' in row ? row.groups.length : row.units
    case 'lessons': return row.lessons
    case 'days': return row.days.length
    default: return row.minutes
  }
}
function toggle(id: string) { expanded.value = expanded.value === id ? null : id }
watch(view, value => {
  query.value = ''
  expanded.value = null
  sorting.key.value = 'hours'
  sorting.direction.value = 'desc'
  const url = new URL(location.href)
  url.searchParams.set('stats_by', value)
  window.history.replaceState(null, '', url)
})
watch(query, () => { expanded.value = null })
</script>

<template>
  <section class="feature-page statistics-page" aria-labelledby="statistics-title">
    <div class="statistics-heading">
      <h1 id="statistics-title">Statistics</h1>
      <div class="view-switch" role="group" aria-label="Statistics grouping">
        <button type="button" :class="{selected:view==='unit'}" :aria-pressed="view==='unit'" @click="view='unit'"><AppIcon name="book" :size="16" />By unit</button>
        <button type="button" :class="{selected:view==='group'}" :aria-pressed="view==='group'" @click="view='group'"><AppIcon name="seats" :size="16" />By group</button>
      </div>
    </div>
    <div class="insight-metrics statistics-metrics">
      <div><strong>{{ statistics.units.length }}</strong>units</div>
      <div><strong>{{ statistics.groups.length }}</strong>groups with lessons</div>
      <div><strong>{{ lessonHours(statistics.minutes) }}<small>h</small></strong>weekly lesson hours across groups</div>
    </div>
    <p class="availability-scope statistics-policy">Weekly lesson hours are added across groups. Each listed lesson counts once for its group, even when it uses several rooms. Shared sessions remain separate group lessons. Complete unit codes combine printed-name variants. Activities are excluded; these are not lecturer contact hours or whole-unit teaching hours.</p>
    <div class="statistics-search-row">
      <label class="group-search statistics-search"><AppIcon name="search" :size="17" /><input v-model="query" type="search" :aria-label="view==='unit'?'Search units':'Search groups'" :placeholder="view==='unit'?'Search unit name or code…':'Search group…'" /></label>
      <span role="status">{{ matching }} {{ view==='unit' ? (matching===1?'unit':'units') : (matching===1?'group':'groups') }}</span>
    </div>
    <div v-if="matching" class="room-table-wrap statistics-table-wrap" role="region" :aria-label="view==='unit'?'Unit statistics':'Group statistics'" tabindex="0">
      <table class="room-table statistics-table">
        <thead><tr>
          <SortHeader :label="view==='unit'?'Unit':'Group'" column="name" :sort-key="sorting.key.value" :direction="sorting.direction.value" @sort="sorting.toggle" />
          <SortHeader v-if="view==='unit'" label="Unit code" column="code" :sort-key="sorting.key.value" :direction="sorting.direction.value" @sort="sorting.toggle" />
          <SortHeader :label="view==='unit'?'Groups':'Units'" column="count" :sort-key="sorting.key.value" :direction="sorting.direction.value" numeric @sort="sorting.toggle" />
          <SortHeader label="Lessons" column="lessons" :sort-key="sorting.key.value" :direction="sorting.direction.value" numeric @sort="sorting.toggle" />
          <SortHeader label="Weekly hours" column="hours" :sort-key="sorting.key.value" :direction="sorting.direction.value" numeric @sort="sorting.toggle" />
          <SortHeader label="Scheduled days" column="days" :sort-key="sorting.key.value" :direction="sorting.direction.value" @sort="sorting.toggle" />
          <th scope="col"><span class="sr-only">Details</span></th>
        </tr></thead>
        <tbody v-if="view==='unit'">
          <template v-for="row in units" :key="row.id">
            <tr><th scope="row" class="statistics-unit-name">{{ row.name }}</th><td class="statistics-code">{{ row.code ?? 'Not printed' }}<small v-if="row.codeStatus==='placeholder'">Placeholder code</small></td><td class="numeric">{{ row.groups.length }}</td><td class="numeric">{{ row.lessons }}</td><td class="numeric statistics-hours">{{ lessonHours(row.minutes) }}</td><td><ScheduledDays :days="row.days" /></td><td><button type="button" class="secondary-button statistics-details-button" :aria-expanded="expanded===row.id" :aria-label="`Groups for ${row.name}, ${row.code ?? 'no code printed'}`" @click="toggle(row.id)">{{ expanded===row.id?'Hide groups':'View groups' }}<AppIcon name="chevron" :size="14" /></button></td></tr>
            <tr v-if="expanded===row.id" class="expanded-room"><td colspan="7" class="statistics-detail-cell"><h2>{{ row.name }} · by group</h2><p v-if="row.names.length>1" class="statistics-name-note">Also printed as: {{ row.names.slice(1).join('; ') }}</p><table class="statistics-breakdown"><caption class="sr-only">{{ row.name }} group breakdown</caption><thead><tr><th scope="col">Group</th><th scope="col" class="numeric">Lessons</th><th scope="col" class="numeric">Weekly hours</th><th scope="col">Scheduled days</th></tr></thead><tbody><tr v-for="group in detailGroups" :key="group.id"><th scope="row">{{ group.id }}</th><td class="numeric">{{ group.lessons }}</td><td class="numeric">{{ lessonHours(group.minutes) }}</td><td><ScheduledDays :days="group.days" /></td></tr></tbody></table></td></tr>
          </template>
        </tbody>
        <tbody v-else>
          <template v-for="row in groups" :key="row.id">
            <tr><th scope="row">{{ row.id }}</th><td class="numeric">{{ row.units }}</td><td class="numeric">{{ row.lessons }}</td><td class="numeric statistics-hours">{{ lessonHours(row.minutes) }}</td><td><ScheduledDays :days="row.days" /></td><td><button type="button" class="secondary-button statistics-details-button" :aria-expanded="expanded===row.id" :aria-label="`Units for ${row.id}`" @click="toggle(row.id)">{{ expanded===row.id?'Hide units':'View units' }}<AppIcon name="chevron" :size="14" /></button></td></tr>
            <tr v-if="expanded===row.id" class="expanded-room"><td colspan="6" class="statistics-detail-cell"><h2>{{ row.id }} · by unit</h2><table class="statistics-breakdown"><caption class="sr-only">{{ row.id }} unit breakdown</caption><thead><tr><th scope="col">Unit</th><th scope="col">Unit code</th><th scope="col" class="numeric">Lessons</th><th scope="col" class="numeric">Weekly hours</th><th scope="col">Scheduled days</th></tr></thead><tbody><tr v-for="unit in detailUnits" :key="unit.id"><th scope="row" class="statistics-unit-name">{{ unit.name }}</th><td>{{ unit.code ?? 'Not printed' }}<small v-if="unit.codeStatus==='placeholder'">Placeholder code</small></td><td class="numeric">{{ unit.lessons }}</td><td class="numeric">{{ lessonHours(unit.minutes) }}</td><td><ScheduledDays :days="unit.days" /></td></tr></tbody></table></td></tr>
          </template>
        </tbody>
      </table>
    </div>
    <p v-else class="statistics-empty">No {{ view==='unit'?'units':'groups' }} match this search.<button v-if="query" type="button" class="text-button" @click="query=''">Clear search</button></p>
  </section>
</template>
