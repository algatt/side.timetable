<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import AppIcon from './components/AppIcon.vue'
import WeekGrid from './components/WeekGrid.vue'
import ScheduleScope from './components/ScheduleScope.vue'
import { useMaltaClock } from './lib/useMaltaClock'
const { local: currentMaltaTime } = useMaltaClock()
import LessonDetails from './components/LessonDetails.vue'
import RoomFinder from './components/RoomFinder.vue'
import LabDirectory from './components/LabDirectory.vue'
import LiveRooms from './components/LiveRooms.vue'
import RoomUsage from './components/RoomUsage.vue'
import ChangesView from './components/ChangesView.vue'
const extraTools = [{id:'now',label:'Free now',icon:'clock'},{id:'usage',label:'Room usage',icon:'chart'},{id:'changes',label:'Changes',icon:'changes'}] as const

import { WEEKDAYS, assertDataset, entriesForGroup, entriesForRoom, scheduleRooms, entryLabel, hasSourceNote, sourceUrl, subjectTone } from './lib/timetable'
import type { Dataset, Entry } from './lib/timetable'

const mascotUrl = `${import.meta.env.BASE_URL}mascot.png`
const data = ref<Dataset | null>(null)
const loading = ref(true)
const loadError = ref(false)
const query = ref('')
const groupId = ref('')
const roomId = ref('ICT-126')
const scheduleScope = ref<'group' | 'room'>('group')
const tool = ref<'timetable' | 'rooms' | 'labs' | 'now' | 'usage' | 'changes'>('timetable')
const mobileTools = computed(() => [
  {id:'timetable',label:'Timetables',icon:'calendar'},
  {id:'rooms',label:'Find a room',icon:'room'},
  ...(data.value?.lab_inventory ? [{id:'labs',label:'Lab directory',icon:'book'}] : []),
  ...extraTools,
])
const currentToolIcon = computed(() => mobileTools.value.find(item=>item.id===tool.value)?.icon ?? 'calendar')

const view = ref<'week' | 'list'>(window.matchMedia('(max-width: 760px)').matches ? 'list' : 'week')
const selectedEntry = ref<Entry | null>(null)
let controller: AbortController | undefined
const selectedGroup = computed(() => data.value?.groups.find(group => group.id === groupId.value))
const entries = computed(() => data.value ? scheduleScope.value === 'room' ? entriesForRoom(data.value, roomId.value) : entriesForGroup(data.value, groupId.value) : [])
const scheduleLabel = computed(() => scheduleScope.value === 'room' ? roomId.value : selectedGroup.value?.label ?? '')
const scheduleOptions = computed(() => !data.value ? [] : scheduleScope.value === 'group' ? data.value.groups : scheduleRooms(data.value).map(room => ({ id: room, label: room, entry_count: entriesForRoom(data.value!, room).length })))
const scheduleId = computed({ get: () => scheduleScope.value === 'room' ? roomId.value : groupId.value, set: (value: string) => selectGroup(value) })
const roomUnlisted = computed(() => scheduleScope.value === 'room' && !data.value?.rooms.includes(roomId.value))
const searchTerm = computed(() => query.value.toLowerCase().replace(/[\s-]+/g, ''))
const filteredGroups = computed(() => scheduleOptions.value.filter(group => group.label.toLowerCase().replace(/[\s-]+/g, '').includes(searchTerm.value)) ?? [])
const lessons = computed(() => entries.value.filter(entry => entry.entry_kind === 'lesson').length)
const activities = computed(() => entries.value.length - lessons.value)
const blockHours = computed(() => new Intl.NumberFormat('en-GB', { maximumFractionDigits: 1 }).format(entries.value.reduce((sum, entry) => sum + entry.duration_minutes, 0) / 60))
const dayCount = computed(() => new Set(entries.value.map(entry => entry.weekday)).size)
const sourceNotes = computed(() => entries.value.filter(hasSourceNote).length)
const originalPdf = computed(() => sourceUrl(data.value?.source.pdf_url ?? null))
const activePdf = computed(() => tool.value === 'labs' && data.value?.lab_inventory ? `${import.meta.env.BASE_URL}data/iict-labs.pdf` : originalPdf.value)
const prepared = computed(() => data.value ? new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Malta' }).format(new Date(data.value.generated_at)) : '')
const dayLists = computed(() => WEEKDAYS.filter((day, i) => i < 5 || entries.value.some(entry => entry.weekday === day)).map(day => ({ day, entries: entries.value.filter(entry => entry.weekday === day) })))

function restoreGroup() {
  const params = new URL(window.location.href).searchParams
  const requested = params.get('group')
  if (data.value?.groups.some(group => group.id === requested)) groupId.value = requested!
  scheduleScope.value = params.get('by') === 'room' ? 'room' : 'group'
  const requestedRoom = params.get('schedule_room')
  if (data.value && requestedRoom && scheduleRooms(data.value).includes(requestedRoom)) roomId.value = requestedRoom
  const requestedTool=params.get('tool'); tool.value = ['rooms','labs','now','usage','changes'].includes(requestedTool ?? '') ? requestedTool as typeof tool.value : 'timetable'
}
function selectGroup(id: string) { if (scheduleScope.value === 'room') roomId.value = id; else groupId.value = id; tool.value = 'timetable' }
function changeScope(value: 'group' | 'room') { scheduleScope.value = value; query.value = '' }
async function loadData() {
  loading.value = true
  loadError.value = false
  controller?.abort()
  controller = new AbortController()
  const timeout = window.setTimeout(() => controller?.abort(), 15000)
  try {
    const response = await fetch(`${import.meta.env.BASE_URL}data/timetable.json`, { signal: controller.signal, cache: 'no-store' })
    if (!response.ok) throw new Error(`Timetable request failed (${response.status}).`)
    const parsed: unknown = await response.json()
    assertDataset(parsed)
    data.value = parsed
    groupId.value = parsed.groups.find(group => group.id === 'IT-FIT-2.1A')?.id ?? parsed.groups.find(group => group.lesson_count > 0)?.id ?? parsed.groups[0].id
    restoreGroup()
  } catch (error) {
    console.error('Could not load timetable:', error)
    loadError.value = true
  } finally { window.clearTimeout(timeout); loading.value = false }
}
watch([groupId, roomId, scheduleScope, tool], () => {
  selectedEntry.value = null
  if (!groupId.value) return
  const url = new URL(window.location.href)
  url.searchParams.set('group', groupId.value)
  url.searchParams.set('by', scheduleScope.value)
  if (scheduleScope.value === 'room') url.searchParams.set('schedule_room', roomId.value)
  if (tool.value !== 'timetable') url.searchParams.set('tool', tool.value)
  else url.searchParams.delete('tool')
  window.history.replaceState(null, '', url)
})
onMounted(() => { loadData(); window.addEventListener('popstate', restoreGroup) })
onBeforeUnmount(() => { controller?.abort(); window.removeEventListener('popstate', restoreGroup) })
</script>

<template>
  <div class="app-shell">
    <aside class="sidebar" aria-label="Choose timetable">
      <a class="brand" href="./" aria-label="MCAST ICT timetable home"><img class="brand-mascot" :src="mascotUrl" alt="" width="49" height="56" /><span><strong>MCAST <span>ICT</span></strong></span></a>
      <ScheduleScope class="sidebar-scope" :model-value="scheduleScope" @update:model-value="changeScope" />
      <label class="group-search"><AppIcon name="search" :size="17" /><input v-model="query" type="search" :aria-label="scheduleScope === 'room' ? 'Search rooms' : 'Search groups and activities'" :placeholder="scheduleScope === 'room' ? 'Search rooms…' : 'Search groups…'" /></label>
      <nav class="group-list" :aria-label="scheduleScope === 'room' ? 'Rooms' : 'Groups and activities'">
        <button v-for="group in filteredGroups" :key="group.id" type="button" class="group-option" :class="{ active: tool === 'timetable' && scheduleId === group.id }" :aria-current="tool === 'timetable' && scheduleId === group.id ? 'true' : undefined" @click="selectGroup(group.id)">
          <span>{{ group.label }}</span><AppIcon v-if="tool === 'timetable' && scheduleId === group.id" name="chevron" :size="15" /><small v-else>{{ group.entry_count }}</small>
        </button>
        <p v-if="data && !filteredGroups.length" class="search-empty">No matching schedules.<button type="button" class="text-button" @click="query = ''">Clear search</button></p>
      </nav>
      <div v-if="data" class="sidebar-footer"><p>PDF last processed<br /><time :datetime="data.generated_at" title="Malta time">{{ prepared }}</time></p></div>
    </aside>

    <main class="main-content">
      <header class="topbar"><a class="mobile-mascot-brand" href="./" aria-label="MCAST ICT timetable home"><img :src="mascotUrl" alt="" width="28" height="32" /></a><div class="mobile-tool-picker"><label for="mobile-tool" class="sr-only">Page</label><AppIcon :name="currentToolIcon" :size="17" /><select id="mobile-tool" v-model="tool" :disabled="loading"><option v-for="item in mobileTools" :key="item.id" :value="item.id">{{ item.label }}</option></select></div><div class="workspace-navigation" role="group" aria-label="Timetable tools"><button type="button" :class="{ selected: tool === 'timetable' }" :aria-pressed="tool === 'timetable'" @click="tool = 'timetable'"><AppIcon name="calendar" :size="17" />Timetables</button><button type="button" :class="{ selected: tool === 'rooms' }" :aria-pressed="tool === 'rooms'" @click="tool = 'rooms'"><AppIcon name="room" :size="17" />Find a room</button><button v-if="data?.lab_inventory" type="button" :class="{ selected: tool === 'labs' }" :aria-pressed="tool === 'labs'" @click="tool = 'labs'"><AppIcon name="book" :size="17" /><span class="lab-nav-long">Lab directory</span><span class="lab-nav-short">Labs</span></button><button v-for="item in extraTools" :key="item.id" :class="{selected:tool===item.id}" :aria-pressed="tool===item.id" @click="tool=item.id"><AppIcon :name="item.icon" :size="17" />{{ item.label }}</button></div><a v-if="activePdf" :href="activePdf" target="_blank" rel="noopener noreferrer" class="secondary-button"><span><span class="pdf-full-label">Source </span>PDF</span><AppIcon name="arrow" :size="16" /></a></header>

      <div v-if="loading" class="loading-state" role="status"><span class="spinner"></span><h1>Loading your timetable</h1><p>Getting the published weekly schedules.</p></div>
      <div v-else-if="loadError" class="error-state" role="alert"><AppIcon name="info" :size="32" /><h1>The timetable couldn’t be loaded</h1><p>The data is unavailable or could not be read. Please try again.</p><button type="button" class="primary-button" @click="loadData">Try again</button></div>

      <template v-else-if="data && selectedGroup">
        <RoomFinder v-if="tool === 'rooms'" :key="data.generated_at" :data="data" @select="selectedEntry = $event" />
        <LabDirectory v-else-if="tool === 'labs'" :data="data" />
        <LiveRooms v-else-if="tool === 'now'" :data="data" />
        <RoomUsage v-else-if="tool === 'usage'" :data="data" />
        <ChangesView v-else-if="tool === 'changes'" :data="data" />
        <template v-else>
        <ScheduleScope class="mobile-scope" :model-value="scheduleScope" @update:model-value="changeScope" /><div class="mobile-group-picker"><label for="mobile-group">{{ scheduleScope === 'room' ? 'Room' : 'Group or activity' }}</label><select id="mobile-group" v-model="scheduleId"><option v-for="group in scheduleOptions" :key="group.id" :value="group.id">{{ group.label }}</option></select></div>
        <section class="schedule-hero" aria-labelledby="group-heading"><div><h1 id="group-heading">{{ scheduleLabel }}</h1></div></section>

        <p v-if="roomUnlisted" class="source-banner" role="note">This room is in the lab inventory but has no current timetable listing. Availability is unconfirmed.</p><div class="schedule-toolbar"><div class="schedule-metrics"><span><AppIcon name="book" /><strong>{{ lessons || activities }}</strong>{{ lessons ? 'lessons' : 'activities' }}</span><span><AppIcon name="clock" /><strong>{{ blockHours }}</strong>block hours</span><span><AppIcon name="calendar" /><strong>{{ dayCount }}</strong>{{ dayCount === 1 ? 'day' : 'days' }}</span></div><div class="view-switch" role="group" aria-label="Timetable view"><button type="button" :class="{ selected: view === 'week' }" :aria-pressed="view === 'week'" @click="view = 'week'"><AppIcon name="grid" :size="16" />Week</button><button type="button" :class="{ selected: view === 'list' }" :aria-pressed="view === 'list'" @click="view = 'list'"><AppIcon name="list" :size="17" />List</button></div></div>
        <div v-if="sourceNotes" class="source-banner" role="note"><AppIcon name="info" :size="17" /><p>{{ sourceNotes }} {{ sourceNotes === 1 ? 'block has' : 'blocks have' }} missing or placeholder source details. Select a block to see its notes.</p></div>
        <p class="sr-only" aria-live="polite">{{ scheduleLabel }}: {{ entries.length }} timetable blocks loaded.</p>

        <div class="schedule-board"><div class="board-caption"><span><span class="small-dot"></span>Published weekly timetable</span><small>Select a block for details</small></div>
          <WeekGrid v-if="view === 'week'" :entries="entries" :group="scheduleLabel" :show-groups="scheduleScope === 'room'" @select="selectedEntry = $event" />
          <div v-else class="agenda" :aria-label="`Timetable list for ${scheduleLabel}`"><section v-for="day in dayLists" :key="day.day" class="agenda-day"><div class="agenda-day-title" :class="{'is-today':day.day===currentMaltaTime.weekday}"><h2 :aria-current="day.day===currentMaltaTime.weekday?'date':undefined">{{ day.day }}<span v-if="day.day===currentMaltaTime.weekday" class="today-label">Today</span></h2><span>{{ day.entries.length }} {{ day.entries.length === 1 ? 'block' : 'blocks' }}</span></div><p v-if="!day.entries.length" class="agenda-empty">No scheduled blocks</p><div v-else class="agenda-items"><button v-for="entry in day.entries" :key="entry.id" type="button" class="agenda-entry" :class="`tone-${subjectTone(entry)}`" :aria-label="entryLabel(entry)" @click="selectedEntry = entry"><span class="agenda-time">{{ entry.start }}<small>{{ entry.end }}</small></span><span class="agenda-subject"><strong>{{ entry.subject_name }}</strong><small><template v-if="scheduleScope === 'room'">{{ entry.group }} · </template>{{ entry.subject_code || 'No code printed' }}<span v-if="hasSourceNote(entry)" class="source-note-label">Source note</span></small></span><span class="agenda-rooms"><AppIcon name="room" :size="15" />{{ entry.rooms.join(' · ') || 'Not specified' }}</span><AppIcon name="chevron" :size="16" /></button></div></section></div>
          <div class="board-footer"><AppIcon name="info" :size="15" /><span>Every room listed in a block is reserved for its full duration.</span><span class="mobile-swipe" v-if="view === 'week'">Scroll horizontally to see all days.</span></div>
        </div>
        </template>
        <footer class="page-footer"><p>Based on the institute’s published weekly timetable. Ad hoc changes may not be reflected.</p></footer>
      </template>
    </main>
    <LessonDetails v-if="selectedEntry && data" :key="selectedEntry.id" :entry="selectedEntry" :pdf-url="data.source.pdf_url" :lab-inventory="data.lab_inventory" @close="selectedEntry = null" />
  </div>
</template>
