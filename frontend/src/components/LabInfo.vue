<script setup lang="ts">
import { computed } from 'vue'
import type { Lab } from '../lib/labs'
import AppIcon from './AppIcon.vue'
import OsBadges from './OsBadges.vue'
const props = defineProps<{ lab: Lab; equipmentOnly?: boolean }>()
const pdfUrl = `${import.meta.env.BASE_URL}data/iict-labs.pdf`
const facts = computed(() => [
  {label:'Seats',icon:'seats',value:props.lab.seating_capacity},
  {label:'Student PCs',icon:'monitor',value:props.lab.student_pcs},
  {label:'Teacher PC',icon:'teacher',value:props.lab.teacher_pc},
  {label:'Smartboard',icon:'board',value:props.lab.smartboard},
  {label:'TV screen',icon:'tv',value:props.lab.tv_screen},
  {label:'Projector',icon:'projector',value:props.lab.projector},
].filter(fact => !props.equipmentOnly || !['Seats','Student PCs'].includes(fact.label)))
const describe = (value: number | true | null) => value === true ? 'Listed' : value === null ? 'Not listed' : String(value)
</script>
<template>
  <div class="lab-info compact-lab-info">
    <div class="lab-icon-facts" role="list" aria-label="Capacity and equipment">
      <span v-for="fact in facts" :key="fact.label" role="listitem" class="lab-icon-fact" :class="{unknown:fact.value===null}" :title="`${fact.label}: ${describe(fact.value)}`" :aria-label="`${fact.label}: ${describe(fact.value)}`"><AppIcon :name="fact.icon" :size="18" /><span class="lab-fact-label" aria-hidden="true">{{ fact.label }}</span><strong aria-hidden="true">{{ fact.value === true ? '✓' : fact.value ?? '—' }}</strong></span>
      <OsBadges v-if="!equipmentOnly" :os="lab.os" />
    </div>
    <a class="compact-lab-source" :href="`${pdfUrl}#page=${lab.source_page}`" target="_blank" rel="noopener noreferrer">Lab PDF · page {{ lab.source_page }}<AppIcon name="arrow" :size="12" /></a>
  </div>
</template>
