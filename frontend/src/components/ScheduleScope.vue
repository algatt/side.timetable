<script setup lang="ts">
defineProps<{ modelValue: 'group' | 'room' }>()
defineEmits<{ 'update:modelValue': [value: 'group' | 'room'] }>()
</script>
<template>
  <div class="view-switch schedule-scope" role="group" aria-label="Schedule grouping">
    <button type="button" :class="{ selected: modelValue === 'group' }" :aria-pressed="modelValue === 'group'" @click="$emit('update:modelValue', 'group')">Group</button>
    <button type="button" :class="{ selected: modelValue === 'room' }" :aria-pressed="modelValue === 'room'" @click="$emit('update:modelValue', 'room')">Room</button>
  </div>
</template>
