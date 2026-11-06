<script setup lang="ts">
import { computed } from 'vue'
import { WEEKDAYS, entryLabel, hasSourceNote, layoutDay, subjectTone, timeRange, toMinutes } from '../lib/timetable'
import type { Entry } from '../lib/timetable'
import { useMaltaClock } from '../lib/useMaltaClock'
import { currentTimePosition } from '../lib/insights'
const { now, local } = useMaltaClock()

const props = defineProps<{ entries: Entry[]; group: string; showGroups?: boolean }>()
defineEmits<{ select: [entry: Entry] }>()
const range = computed(() => timeRange(props.entries))
const days = computed(() => WEEKDAYS.filter((day, index) => index < 5 || props.entries.some(entry => entry.weekday === day)))
const height = computed(() => (range.value.end - range.value.start) * 1.2)
const hours = computed(() => Array.from({ length: (range.value.end - range.value.start) / 60 + 1 }, (_, i) => range.value.start + i * 60))
const dayEntries = computed(() => days.value.map(day => ({ day, entries: layoutDay(props.entries.filter(entry => entry.weekday === day)), marker: currentTimePosition(day, range.value, now.value) })))
const clock = (value: number) => `${String(Math.floor(value / 60)).padStart(2, '0')}:00`
</script>

<template>
  <div class="calendar-scroll" role="region" :aria-label="`Weekly timetable for ${group}`" tabindex="0">
    <div class="calendar-grid" :style="{ '--days': days.length }">
      <div class="calendar-head"><div class="time-heading">TIME</div><div v-for="day in days" :key="day" class="day-heading" :class="{'is-today':day===local.weekday}" :aria-current="day===local.weekday?'date':undefined">{{ day }}<span v-if="day===local.weekday" class="today-label">Today</span></div></div>
      <div class="calendar-body">
        <div class="time-column" :style="{ height: `${height}px` }" aria-hidden="true"><span v-for="hour in hours" :key="hour" :style="{ top: `${(hour - range.start) * 1.2}px` }">{{ clock(hour) }}</span></div>
        <section v-for="day in dayEntries" :key="day.day" class="day-track" :class="{'is-today':day.day===local.weekday}" :style="{ height: `${height}px` }" :aria-label="`${day.day} schedule`">
          <div v-if="day.marker !== null" class="current-time-marker" :style="{top:`${day.marker * height}px`}" role="img" :aria-label="`Current Malta time: ${local.time}`"><span>Now {{ local.time }}</span></div>
          <p v-if="!day.entries.length" class="empty-day">No scheduled<br>blocks</p>
          <button v-for="item in day.entries" :key="item.entry.id" type="button" class="lesson-card" :class="[`tone-${subjectTone(item.entry)}`, { compact: item.entry.duration_minutes < 60 }]"
            :style="{ top: `${(toMinutes(item.entry.start) - range.start) * 1.2 + 2}px`, height: `${item.entry.duration_minutes * 1.2 - 4}px`, left: `calc(${item.lane / item.lanes * 100}% + 3px)`, width: `calc(${100 / item.lanes}% - 6px)` }"
            :aria-label="entryLabel(item.entry)" @click="$emit('select', item.entry)">
            <span class="lesson-time">{{ item.entry.start }} – {{ item.entry.end }}<span v-if="hasSourceNote(item.entry)" class="source-dot" title="Source details are incomplete">*</span></span>
            <strong class="lesson-name">{{ item.entry.subject_name }}</strong>
            <span class="lesson-room">{{ showGroups ? item.entry.group : item.entry.rooms.join(' · ') || 'Room not specified' }}</span>
          </button>
        </section>
      </div>
    </div>
  </div>
</template>
