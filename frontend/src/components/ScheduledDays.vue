<script setup lang="ts">
import { computed } from 'vue'
import { WEEKDAYS } from '../lib/timetable'
import { lessonHours } from '../lib/statistics'
import type { DailyLessonHours } from '../lib/statistics'

const props = defineProps<{ byDay: readonly DailyLessonHours[]; maxMinutes: number }>()
// Always show the five weekdays. Retain weekend lessons if a future PDF has any.
const displayedDays = computed(() => WEEKDAYS.filter((day, index) => index < 5 || props.byDay.some(item => item.day === day && item.minutes > 0))
  .map(day => ({ day, minutes: props.byDay.find(item => item.day === day)?.minutes ?? 0 })))
const description = computed(() => `Weekly scheduled hours by day: ${displayedDays.value.map(item => `${item.day} ${lessonHours(item.minutes)} hours`).join('; ')}. Scale: 0 to ${lessonHours(props.maxMinutes)} hours.`)
</script>

<template>
  <div class="scheduled-days" role="img" :aria-label="description">
    <div v-for="item in displayedDays" :key="item.day" class="scheduled-day" :title="`${item.day}: ${lessonHours(item.minutes)} scheduled hours`" aria-hidden="true">
      <div class="scheduled-day-track"><span :style="{height:`${item.minutes/Math.max(1,maxMinutes)*100}%`}" /></div>
      <span class="scheduled-day-label">{{ item.day.slice(0,3) }}</span>
    </div>
  </div>
</template>
