<script setup lang="ts">
import type { LabFilters } from '../lib/labs'
const props = defineProps<{ modelValue: LabFilters; idPrefix: string }>()
const emit = defineEmits<{ 'update:modelValue': [value: LabFilters] }>()
function setNumber(field: 'minimumSeats' | 'minimumStudentPcs', event: Event) {
  const value = (event.target as HTMLInputElement).value
  emit('update:modelValue', { ...props.modelValue, [field]: value === '' ? null : Number(value) })
}
function setChoice(field: 'kind' | 'os' | 'display', event: Event) {
  emit('update:modelValue', { ...props.modelValue, [field]: (event.target as HTMLSelectElement).value })
}
</script>
<template>
  <div class="lab-filters">
    <div><label :for="`${idPrefix}-seats`">Minimum seats</label><input :id="`${idPrefix}-seats`" type="number" min="0" max="10000" step="1" placeholder="Any" :value="modelValue.minimumSeats" @input="setNumber('minimumSeats', $event)" /></div>
    <div><label :for="`${idPrefix}-pcs`">Minimum student PCs</label><input :id="`${idPrefix}-pcs`" type="number" min="0" max="10000" step="1" placeholder="Any" :value="modelValue.minimumStudentPcs" @input="setNumber('minimumStudentPcs', $event)" /></div>
    <div><label :for="`${idPrefix}-kind`">Room type</label><select :id="`${idPrefix}-kind`" :value="modelValue.kind" @change="setChoice('kind', $event)"><option value="all">Any type</option><option value="computer_lab">Computer lab</option><option value="classroom">Classroom</option><option value="other">Other room</option></select></div>
    <div><label :for="`${idPrefix}-os`">Operating system</label><select :id="`${idPrefix}-os`" :value="modelValue.os" @change="setChoice('os', $event)"><option value="all">Any OS</option><option value="windows">Windows</option><option value="ubuntu">Ubuntu</option><option value="macos">macOS</option></select></div>
    <div><label :for="`${idPrefix}-display`">Display equipment</label><select :id="`${idPrefix}-display`" :value="modelValue.display" @change="setChoice('display', $event)"><option value="all">Any display</option><option value="smartboard">Smartboard</option><option value="tv_screen">TV screen</option><option value="projector">Projector</option></select></div>
  </div>
</template>
