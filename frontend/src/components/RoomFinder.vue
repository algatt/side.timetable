<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import AppIcon from './AppIcon.vue'
import { entryLabel, toMinutes } from '../lib/timetable'
import type { Dataset, Entry, Weekday } from '../lib/timetable'
import { findRooms, overlapsInterval, unassignedBlocks, validateRoomRequest } from '../lib/roomAvailability'
import type { RoomRequest, RoomResult } from '../lib/roomAvailability'
import { emptyLabFilters, labFiltersFromParams, writeLabFilterParams } from '../lib/labs'
import LabFilters from './LabFilters.vue'
import LabInfo from './LabInfo.vue'
import { alternatives } from '../lib/insights'
import SortHeader from './SortHeader.vue'
import { sortRows } from '../lib/tableSort'
import { useTableSort } from '../lib/useTableSort'
const sorting = useTableSort('room')
const alternativeSorting = useTableSort('room')
const alternativeSource = ref('')
const alternativeResults = computed(() => applied.value && alternativeSource.value ? alternatives(props.data,alternativeSource.value,applied.value) : null)

const props = defineProps<{ data: Dataset }>()
defineEmits<{ select: [entry: Entry] }>()
const params = new URL(window.location.href).searchParams
const coverage = computed(() => props.data.schedule_coverage)
const profiles = computed(() => new Map(props.data.lab_inventory?.rooms.map(lab => [lab.room, lab]) ?? []))
const labFilters = ref(labFiltersFromParams(params))
const defaultDay = coverage.value?.weekdays.includes('Friday') ? 'Friday' : coverage.value?.weekdays[0] ?? 'Monday'
const defaultStart = coverage.value?.start ?? '08:00'
const endMinutes = Math.min(toMinutes(defaultStart) + 90, toMinutes(coverage.value?.end ?? '20:00'))
const defaultEnd = `${String(Math.floor(endMinutes / 60)).padStart(2, '0')}:${String(endMinutes % 60).padStart(2, '0')}`
const weekday = ref((params.get('day') ?? defaultDay) as Weekday)
const start = ref(params.get('start') ?? defaultStart)
const end = ref(params.get('end') ?? defaultEnd)
const roomQuery = ref(params.get('room') ?? '')
const showBusy = ref(false)
const expandedRoom = ref('')
const applied = ref<RoomRequest | null>(null)
const results = ref<RoomResult[]>([])
const error = ref('')
const currentRequest = computed<RoomRequest>(() => ({ weekday: weekday.value, start: start.value, end: end.value, building: 'ICT', roomQuery: '', labFilters: labFilters.value }))
const pending = computed(() => applied.value !== null && JSON.stringify(currentRequest.value) !== JSON.stringify(applied.value))
const matchingResults = computed(() => { const query = roomQuery.value.toUpperCase().replace(/[\s-]+/g, ''); return results.value.filter(result => result.room.replace(/[\s-]+/g, '').includes(query)) })
function sortRoomValue(result: RoomResult, column: string) {
  const lab=profiles.value.get(result.room)
  return column==='availability'?(result.available?0:1):column==='until'?(result.available?(result.nextStart ?? coverage.value?.end):null):column==='seats'?lab?.seating_capacity:column==='pcs'?lab?.student_pcs:column==='os'?lab?.os:result.room
}
const visibleResults = computed(() => sortRows(matchingResults.value.filter(result => result.available || showBusy.value),result=>sortRoomValue(result,sorting.key.value),sorting.direction.value,result=>result.room))
const sortedAlternatives = computed(() => sortRows(alternativeResults.value?.rooms ?? [],result=>sortRoomValue(result,alternativeSorting.key.value),alternativeSorting.direction.value,result=>result.room))
const unknownRooms = computed(() => applied.value ? unassignedBlocks(props.data, applied.value) : [])
const duration = computed(() => { try { const minutes = toMinutes(end.value) - toMinutes(start.value); return minutes > 0 ? minutes : null } catch { return null } })

function search() {
  alternativeSource.value = ''; expandedRoom.value = ''
  const request = { ...currentRequest.value, labFilters: { ...labFilters.value } }
  error.value = validateRoomRequest(props.data, request) ?? ''
  if (error.value) return
  results.value = findRooms(props.data, request)
  applied.value = request
  const url = new URL(window.location.href)
  url.searchParams.set('tool', 'rooms')
  for (const [key, value] of Object.entries({ day: request.weekday, start: request.start, end: request.end, building: request.building })) url.searchParams.set(key, value)
  if (roomQuery.value.trim()) url.searchParams.set('room', roomQuery.value.trim())
  else url.searchParams.delete('room')
  writeLabFilterParams(url.searchParams, request.labFilters)
  window.history.replaceState(null, '', url)
}
function clearRoomFilters() { roomQuery.value = ''; labFilters.value = emptyLabFilters(); search() }
watch(roomQuery, () => { const url = new URL(window.location.href); if(roomQuery.value.trim()) url.searchParams.set('room',roomQuery.value.trim()); else url.searchParams.delete('room'); window.history.replaceState(null,'',url) })
onMounted(search)
</script>

<template>
  <section class="room-finder" aria-labelledby="finder-heading">
    <div class="schedule-hero"><div><h1 id="finder-heading">Find a free room</h1></div></div>
    <div v-if="!coverage" class="source-banner" role="status"><AppIcon name="info" /><p>Room search is unavailable because this timetable does not specify its search hours.</p></div>
    <template v-else>
      <form class="room-search-form" novalidate :aria-describedby="error ? 'room-search-error' : undefined" @submit.prevent="search">
        <div class="room-search-fields">
          <label for="room-day">Weekday<select id="room-day" v-model="weekday"><option v-for="day in coverage.weekdays" :key="day" :value="day">{{ day }}</option></select></label>
          <label for="room-start"><span class="time-field-label">From <span v-if="duration !== null" class="interval-duration">{{ duration }} min</span></span><input id="room-start" v-model="start" type="time" :min="coverage.start" :max="coverage.end" step="60" required /></label>
          <label for="room-end">Until<input id="room-end" v-model="end" type="time" :min="coverage.start" :max="coverage.end" step="60" required /></label>
          <button class="primary-button find-button" type="submit"><AppIcon name="search" :size="17" />Find rooms</button>
        </div>
        <div v-if="data.lab_inventory" class="finder-lab-filters"><LabFilters v-model="labFilters" id-prefix="finder" /></div>
        <p class="published-hours">Published hours {{ coverage.start }}–{{ coverage.end }}</p>
        <p v-if="error" id="room-search-error" class="room-form-error" role="alert"><AppIcon name="info" :size="16" />{{ error }}</p>
        <p v-else-if="pending" class="room-pending" role="status">Search settings changed. Select “Find rooms” to update the results.</p>
      </form>

      <template v-if="applied">
        <div class="room-results-heading"><div><h2>{{ applied.weekday }} <span>{{ applied.start }}–{{ applied.end }}</span></h2></div><div class="room-result-filters"><label class="result-room-search"><AppIcon name="search" :size="16" /><input id="room-query" v-model="roomQuery" type="search" placeholder="Filter rooms, e.g. 126" aria-label="Filter room labels" /></label><label class="busy-toggle"><input v-model="showBusy" type="checkbox" />Show occupied rooms</label></div></div>
        <details v-if="unknownRooms.length" class="unassigned-note"><summary><AppIcon name="info" :size="16" />{{ unknownRooms.length }} overlapping {{ unknownRooms.length === 1 ? 'block has' : 'blocks have' }} no printed room</summary><p>These blocks cannot be assigned to a room and are excluded from room availability calculations.</p><ul><li v-for="entry in unknownRooms" :key="entry.id"><button type="button" @click="$emit('select', entry)">{{ entry.group }} · {{ entry.subject_name }} · {{ entry.start }}–{{ entry.end }}</button></li></ul></details>

        <section v-if="alternativeResults" class="alternatives-panel" aria-live="polite"><div class="room-results-heading"><h2>Alternatives to {{ alternativeSource }}</h2><button class="secondary-button" @click="alternativeSource=''">Close alternatives</button></div><p>{{ applied.weekday }} · {{ applied.start }}–{{ applied.end }}</p><p>Free for the whole interval · same room type · {{ alternativeResults.requirements.join(' · ') || 'Your selected filters' }}</p><p class="availability-scope">Matches known capacity, OS and positive equipment listings, plus your selected filters. Missing source details impose no requirement. Specialist facilities and software need checking.</p><p v-if="alternativeResults.sourceNotes">Source room notes: {{ alternativeResults.sourceNotes }}</p><div v-if="alternativeResults.rooms.length" class="room-table-wrap" role="region" aria-label="Alternative rooms" tabindex="0"><table class="room-table"><thead><tr><SortHeader label="Room" column="room" :sort-key="alternativeSorting.key.value" :direction="alternativeSorting.direction.value" @sort="alternativeSorting.toggle" /><SortHeader label="Free until" column="until" :sort-key="alternativeSorting.key.value" :direction="alternativeSorting.direction.value" @sort="alternativeSorting.toggle" /><SortHeader label="Seats" column="seats" :sort-key="alternativeSorting.key.value" :direction="alternativeSorting.direction.value" numeric @sort="alternativeSorting.toggle" /><SortHeader label="Student PCs" column="pcs" :sort-key="alternativeSorting.key.value" :direction="alternativeSorting.direction.value" numeric @sort="alternativeSorting.toggle" /><SortHeader label="Operating system" column="os" :sort-key="alternativeSorting.key.value" :direction="alternativeSorting.direction.value" @sort="alternativeSorting.toggle" /><th scope="col">Details</th></tr></thead><tbody><tr v-for="room in sortedAlternatives" :key="room.room"><th scope="row">{{ room.room }}</th><td>{{ room.nextStart ?? coverage.end }}<small v-if="!room.nextStart">End of published hours</small></td><td class="numeric">{{ profiles.get(room.room)?.seating_capacity ?? 'Not listed' }}</td><td class="numeric">{{ profiles.get(room.room)?.student_pcs ?? 'Not listed' }}</td><td>{{ profiles.get(room.room)?.os ?? 'Not listed' }}</td><td><details v-if="profiles.get(room.room)" class="table-details"><summary :aria-label="`Lab details for ${room.room}`">Lab details</summary><LabInfo :lab="profiles.get(room.room)!" /></details></td></tr></tbody></table></div><p v-if="!alternativeResults.rooms.length">No confirmed alternatives meet these requirements for the full interval. Try a different time or adjust your filters.</p></section>
        <div v-if="!matchingResults.length" class="room-empty"><AppIcon name="search" :size="30" /><h3>No ICT rooms match these filters</h3><p>Try another room label or adjust the lab requirements.</p><button type="button" class="secondary-button" @click="clearRoomFilters">Clear room filters</button></div>
        <div v-else-if="!visibleResults.length" class="room-empty"><AppIcon name="clock" :size="30" /><h3>No rooms are free for the whole interval</h3><p>Try another time, or inspect the occupied rooms.</p><button type="button" class="secondary-button" @click="showBusy = true">Show occupied rooms</button></div>
        <div v-else class="room-table-wrap" role="region" aria-label="Room availability results" tabindex="0">
          <table class="room-table"><thead><tr><SortHeader label="Room" column="room" :sort-key="sorting.key.value" :direction="sorting.direction.value" @sort="sorting.toggle" /><SortHeader label="Availability" column="availability" :sort-key="sorting.key.value" :direction="sorting.direction.value" @sort="sorting.toggle" /><SortHeader label="Free until / booking" column="until" :sort-key="sorting.key.value" :direction="sorting.direction.value" @sort="sorting.toggle" /><SortHeader label="Seats" column="seats" :sort-key="sorting.key.value" :direction="sorting.direction.value" numeric @sort="sorting.toggle" /><SortHeader label="Student PCs" column="pcs" :sort-key="sorting.key.value" :direction="sorting.direction.value" numeric @sort="sorting.toggle" /><SortHeader label="Operating system" column="os" :sort-key="sorting.key.value" :direction="sorting.direction.value" @sort="sorting.toggle" /><th scope="col">Actions</th></tr></thead><tbody>
            <template v-for="result in visibleResults" :key="result.room">
              <tr><th scope="row">{{ result.room }}</th><td><span class="room-status" :class="{occupied:!result.available}">{{ result.available ? 'Free' : 'Occupied' }}</span></td><td><template v-if="result.available"><strong class="free-until">{{ result.nextStart ?? coverage.end }}</strong><small v-if="!result.nextStart">End of published hours</small></template><template v-else>{{ result.overlaps[0].start }}–{{ result.overlaps[0].end }}<small>{{ result.overlaps.length }} overlapping {{ result.overlaps.length===1?'block':'blocks' }}</small></template></td><td class="numeric">{{ profiles.get(result.room)?.seating_capacity ?? 'Not listed' }}</td><td class="numeric">{{ profiles.get(result.room)?.student_pcs ?? 'Not listed' }}</td><td>{{ profiles.get(result.room)?.os ?? 'Not listed' }}</td><td><div class="table-actions"><button class="secondary-button" :aria-expanded="expandedRoom===result.room" :aria-controls="`room-detail-${result.room}`" @click="expandedRoom=expandedRoom===result.room?'':result.room">{{ expandedRoom===result.room?'Hide details':'Details & schedule' }}<span class="sr-only"> for {{ result.room }}</span></button><button v-if="!result.available" class="secondary-button" :aria-label="`Find alternatives to ${result.room}`" @click="alternativeSource=result.room">Alternatives</button></div></td></tr>
              <tr v-if="expandedRoom===result.room" :id="`room-detail-${result.room}`" class="expanded-room"><td colspan="7"><div class="table-room-details"><div><h3>{{ result.room }} details</h3><LabInfo v-if="profiles.get(result.room)" :lab="profiles.get(result.room)!" /><p v-else>Lab information not listed.</p></div><div><h3>{{ applied.weekday }} schedule</h3><p v-if="!result.dayEntries.length">No bookings printed for this day.</p><ul v-else class="table-bookings"><li v-for="booking in result.dayEntries" :key="booking.id"><button :class="{'overlap-booking':overlapsInterval(booking,applied.start,applied.end)}" :aria-label="`${entryLabel(booking)}; group ${booking.group}`" @click="$emit('select',booking)"><span>{{ booking.start }}–{{ booking.end }}</span><strong>{{ booking.subject_name }}</strong><span>{{ booking.group }}</span><small v-if="overlapsInterval(booking,applied.start,applied.end)">Overlaps search</small></button></li></ul></div></div></td></tr>
            </template>
          </tbody></table>
        </div>
        <p class="room-policy"><AppIcon name="room" :size="15" />Every room in a multi-room block is occupied for the full block. Bookings ending at your start time, or starting at your end time, do not overlap.</p>
      </template>
    </template>
  </section>
</template>
