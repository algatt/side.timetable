<script setup lang="ts">
import type { SortDirection } from '../lib/tableSort'
defineProps<{ column: string; label: string; sortKey: string; direction: SortDirection; numeric?: boolean }>()
defineEmits<{sort:[column:string]}>()
</script>
<template>
  <th scope="col" class="sortable-heading" :class="{numeric}" :aria-sort="sortKey===column?(direction==='asc'?'ascending':'descending'):'none'"><button type="button" :aria-label="`Sort by ${label} ${sortKey===column && direction==='asc'?'descending':'ascending'}`" @click="$emit('sort',column)">{{ label }}<span aria-hidden="true" :class="{active:sortKey===column}">{{ sortKey===column?(direction==='asc'?'↑':'↓'):'↕' }}</span></button></th>
</template>
