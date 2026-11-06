<script setup lang="ts">
import { computed, ref } from 'vue'
import type { Dataset } from '../lib/timetable'
import { emptyLabFilters, KIND_LABELS, labFilterError, matchesLab } from '../lib/labs'
import LabFilters from './LabFilters.vue'
import LabInfo from './LabInfo.vue'
import OsBadges from './OsBadges.vue'
import AppIcon from './AppIcon.vue'
import SortHeader from './SortHeader.vue'
import { sortRows } from '../lib/tableSort'
import { useTableSort } from '../lib/useTableSort'
const sorting = useTableSort('room')
const props = defineProps<{ data: Dataset }>()
const query = ref('')
const filters = ref(emptyLabFilters())
const error = computed(() => labFilterError(filters.value))
const knownRooms = computed(() => new Set(props.data.rooms.filter(room => room.startsWith('ICT-'))))
const missingTimetable = computed(() => props.data.lab_inventory?.rooms.filter(lab => !knownRooms.value.has(lab.room)).length ?? 0)
const filteredRooms = computed(() => {
  if (error.value) return []
  const term = query.value.trim().toLowerCase()
  const roomTerm = term.replace(/[\s-]+/g, '')
  return (props.data.lab_inventory?.rooms ?? []).filter(lab => matchesLab(lab, filters.value) &&
    (!term || lab.room.toLowerCase().replace(/[\s-]+/g, '').includes(roomTerm) || `${lab.notes ?? ''} ${lab.os ?? ''}`.toLowerCase().includes(term)))
    .sort((a, b) => a.room.localeCompare(b.room, 'en', { numeric: true }))
})
const rooms = computed(() => sortRows(filteredRooms.value, lab => sorting.key.value==='type'?KIND_LABELS[lab.kind]:sorting.key.value==='seats'?lab.seating_capacity:sorting.key.value==='pcs'?lab.student_pcs:sorting.key.value==='os'?lab.os:sorting.key.value==='notes'?lab.notes:lab.room, sorting.direction.value,lab=>lab.room))
function clear() { query.value = ''; filters.value = emptyLabFilters() }
</script>
<template>
  <section aria-labelledby="lab-directory-heading" class="lab-directory">
    <div class="schedule-hero"><div><h1 id="lab-directory-heading">Lab directory</h1></div><div class="hero-meta"><span class="weekly-badge">{{ data.lab_inventory?.room_count ?? 0 }} ICT rooms</span></div></div>
    <p v-if="!data.lab_inventory" class="source-banner">The lab inventory is not available for this timetable.</p>
    <template v-else>
      <div class="lab-directory-controls"><label class="lab-directory-search"><AppIcon name="search" :size="17" /><input v-model="query" type="search" aria-label="Search lab directory" placeholder="Search room, OS or notes, e.g. Raspberry Pi" /></label><LabFilters v-model="filters" id-prefix="directory" /><p v-if="error" class="room-form-error" role="alert">{{ error }}</p></div>
      <div class="lab-directory-summary"><strong>{{ rooms.length }} {{ rooms.length === 1 ? 'room matches' : 'rooms match' }}</strong><span>{{ missingTimetable }} inventory rooms are not listed in the current timetable.</span></div>
      <p class="availability-scope"><AppIcon name="info" :size="15" />Details are as listed in the lab PDF. Blank cells mean “Not listed”. Rooms without a current timetable listing are shown here, with availability unconfirmed.</p>
      <div v-if="!rooms.length" class="room-empty"><h3>No labs match these filters</h3><button type="button" class="secondary-button" @click="clear">Clear lab filters</button></div>
      <div v-else class="room-table-wrap" role="region" aria-label="Lab directory results" tabindex="0"><table class="room-table lab-table"><thead><tr><SortHeader label="Room" column="room" :sort-key="sorting.key.value" :direction="sorting.direction.value" @sort="sorting.toggle" /><SortHeader label="Type" column="type" :sort-key="sorting.key.value" :direction="sorting.direction.value" @sort="sorting.toggle" /><SortHeader label="Seats" column="seats" :sort-key="sorting.key.value" :direction="sorting.direction.value" numeric @sort="sorting.toggle" /><SortHeader label="Student PCs" column="pcs" :sort-key="sorting.key.value" :direction="sorting.direction.value" numeric @sort="sorting.toggle" /><SortHeader label="Operating system" column="os" :sort-key="sorting.key.value" :direction="sorting.direction.value" @sort="sorting.toggle" /><SortHeader label="Notes" column="notes" :sort-key="sorting.key.value" :direction="sorting.direction.value" @sort="sorting.toggle" /><th scope="col">Details</th></tr></thead><tbody><tr v-for="lab in rooms" :key="lab.room"><th scope="row">{{ lab.room }}<small v-if="!knownRooms.has(lab.room)" class="table-unknown">No timetable listing</small></th><td>{{ KIND_LABELS[lab.kind] }}</td><td class="numeric">{{ lab.seating_capacity ?? 'Not listed' }}</td><td class="numeric">{{ lab.student_pcs ?? 'Not listed' }}</td><td><div class="directory-os"><div class="directory-os-logos" role="list" aria-label="Operating systems"><OsBadges :os="lab.os" /></div><span>{{ lab.os ?? 'Not listed' }}</span></div></td><td>{{ lab.notes ?? '—' }}</td><td class="directory-equipment"><LabInfo :lab="lab" equipment-only /></td></tr></tbody></table></div>
    </template>
  </section>
</template>
