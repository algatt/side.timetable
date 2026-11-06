<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import type { Dataset } from '../lib/timetable'
import { findLiveRooms, maltaNow } from '../lib/insights'
import { unassignedBlocks } from '../lib/roomAvailability'
import LiveRoomTable from './LiveRoomTable.vue'
import AppIcon from './AppIcon.vue'
const props = defineProps<{data: Dataset}>()
const minutes = ref(30), now = ref(new Date())
const timer = window.setInterval(() => { now.value = new Date() }, 30000)
onBeforeUnmount(() => window.clearInterval(timer))
const local = computed(() => maltaNow(now.value))
const localDate = computed(() => new Intl.DateTimeFormat('en-GB', {timeZone:'Europe/Malta',day:'numeric',month:'short'}).format(now.value))
const state = computed(() => {
  try { const {rooms, request} = findLiveRooms(props.data, minutes.value, now.value); return { rooms, unknown: unassignedBlocks(props.data,request).length, error: '' } }
  catch (error) { return {rooms:[],unknown:0,error:(error as Error).message} }
})
</script>
<template><section class="feature-page"><h1>Free now</h1><div class="feature-controls live-controls"><div class="live-clock" :aria-label="`${local.weekday}, ${localDate}, ${local.time} Malta time`"><span class="live-clock-icon"><AppIcon name="clock" :size="24" /></span><div class="live-clock-face"><span class="live-clock-day">{{ local.weekday }}<span class="live-clock-date">{{ localDate }}</span></span><time :datetime="now.toISOString()">{{ local.time }}</time></div></div><label>Needed for<select v-model="minutes"><option v-for="n in [15,30,60,90,120]" :value="n" :key="n">{{ n }} minutes</option></select></label><button class="secondary-button" @click="now = new Date()">Refresh now</button></div><p v-if="state.error" class="source-banner" role="status">{{ state.error }}</p><template v-else><h2>{{ state.rooms.length }} rooms free for {{ minutes }} minutes</h2><p class="availability-scope">Based on the weekly timetable. Ad hoc bookings may not be reflected. Rooms without a timetable listing are excluded.</p><p v-if="state.unknown" class="source-banner">{{ state.unknown }} overlapping blocks have no printed room and cannot be assigned.</p><LiveRoomTable v-if="state.rooms.length" :data="data" :rooms="state.rooms" /><p v-if="!state.rooms.length">No rooms are free for the entire duration. Try a shorter duration.</p></template></section></template>
