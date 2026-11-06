<script setup lang="ts">
import { computed } from 'vue'
import { WEEKDAYS } from '../lib/timetable'
import type { Weekday } from '../lib/timetable'

const props = defineProps<{ days: readonly Weekday[] }>()
// Always show the five weekdays. Retain weekend lessons if a future PDF has any.
const displayedDays = computed(() => WEEKDAYS.filter((day, index) => index < 5 || props.days.includes(day)))
const description = computed(() => `Scheduled days: ${WEEKDAYS.filter(day => props.days.includes(day)).join(', ') || 'none'}`)
</script>

<template>
  <div class="scheduled-days" role="img" :aria-label="description">
    <span v-for="day in displayedDays" :key="day" class="scheduled-day" :class="{'is-scheduled':days.includes(day)}" :title="`${day}: ${days.includes(day)?'lessons scheduled':'no lessons scheduled'}`" aria-hidden="true">{{ day.slice(0,3) }}</span>
  </div>
</template>
