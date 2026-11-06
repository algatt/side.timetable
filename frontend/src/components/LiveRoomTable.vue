<script setup lang="ts">
import { computed, ref } from 'vue'
import type { Dataset } from '../lib/timetable'
import type { LiveRoomResult } from '../lib/insights'
import LabInfo from './LabInfo.vue'
import OsBadges from './OsBadges.vue'
import SortHeader from './SortHeader.vue'
import { sortRows } from '../lib/tableSort'
import { useTableSort } from '../lib/useTableSort'
const sorting = useTableSort('minutes','desc')
const props = defineProps<{data: Dataset; rooms: LiveRoomResult[]}>()
const profiles = computed(() => new Map(props.data.lab_inventory?.rooms.map(lab => [lab.room,lab]) ?? []))
const expanded = ref('')
const roomsSorted = computed(() => sortRows(props.rooms, room => {
  const lab=profiles.value.get(room.room)
  return sorting.key.value==='until'?room.freeUntil:sorting.key.value==='minutes'?room.availableMinutes:sorting.key.value==='seats'?lab?.seating_capacity:sorting.key.value==='pcs'?lab?.student_pcs:sorting.key.value==='os'?lab?.os:room.room
},sorting.direction.value,room=>room.room))
</script>
<template>
  <div class="room-table-wrap" role="region" aria-label="Rooms free now" tabindex="0">
    <table class="room-table live-room-table">
      <thead><tr><SortHeader label="Room" column="room" :sort-key="sorting.key.value" :direction="sorting.direction.value" @sort="sorting.toggle" /><SortHeader label="Free until" column="until" :sort-key="sorting.key.value" :direction="sorting.direction.value" @sort="sorting.toggle" /><SortHeader label="Available minutes" column="minutes" :sort-key="sorting.key.value" :direction="sorting.direction.value" numeric @sort="sorting.toggle" /><SortHeader label="Seats" column="seats" :sort-key="sorting.key.value" :direction="sorting.direction.value" numeric @sort="sorting.toggle" /><SortHeader label="Student PCs" column="pcs" :sort-key="sorting.key.value" :direction="sorting.direction.value" numeric @sort="sorting.toggle" /><SortHeader label="Operating system" column="os" :sort-key="sorting.key.value" :direction="sorting.direction.value" @sort="sorting.toggle" /><th scope="col">Details</th></tr></thead>
      <tbody><template v-for="room in roomsSorted" :key="room.room">
        <tr><th scope="row">{{ room.room }}</th><td><strong class="free-until">{{ room.freeUntil }}</strong><small v-if="room.atClosing">End of published hours</small></td><td class="numeric">{{ room.availableMinutes }}</td><td class="numeric">{{ profiles.get(room.room)?.seating_capacity ?? 'Not listed' }}</td><td class="numeric">{{ profiles.get(room.room)?.student_pcs ?? 'Not listed' }}</td><td><div class="directory-os"><div class="directory-os-logos" role="list" aria-label="Operating systems"><OsBadges :os="profiles.get(room.room)?.os ?? null" /></div><span>{{ profiles.get(room.room)?.os ?? 'Not listed' }}</span></div></td><td><button v-if="profiles.has(room.room)" class="secondary-button" :aria-expanded="expanded===room.room" :aria-controls="`live-details-${room.room}`" @click="expanded=expanded===room.room?'':room.room">{{ expanded===room.room?'Hide equipment':'Equipment' }}<span class="sr-only"> for {{ room.room }}</span></button><span v-else>Not listed</span></td></tr>
        <tr v-if="expanded===room.room && profiles.has(room.room)" :id="`live-details-${room.room}`" class="expanded-room"><td colspan="7"><h3 class="live-equipment-title">{{ room.room }} equipment</h3><LabInfo :lab="profiles.get(room.room)!" equipment-only /></td></tr>
      </template></tbody>
    </table>
  </div>
</template>
