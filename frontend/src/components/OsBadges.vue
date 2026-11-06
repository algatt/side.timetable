<script setup lang="ts">
import { computed } from 'vue'
import AppIcon from './AppIcon.vue'
const props = defineProps<{ os: string | null }>()
const systems = computed(() => {
  const value = props.os?.toLowerCase() ?? ''
  const result: { id: string; label: string; version?: string }[] = []
  if (value.includes('win')) result.push({id:'windows',label:'Windows 10',version:value.includes('10')?'10':undefined})
  if (value.includes('ubuntu')) result.push({id:'ubuntu',label:'Ubuntu'})
  if (value.includes('mac')) result.push({id:'macos',label:'macOS'})
  return result
})
</script>
<template>
  <span v-for="system in systems" :key="system.id" class="lab-icon-fact os-logo-badge" role="listitem" :title="`${system.label} · ${os}`" :aria-label="`Operating system: ${system.label}`">
    <svg v-if="system.id==='windows'" class="os-logo windows-logo" width="19" height="19" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M2 4.5 10.5 3.3v8H2zm10-1.4L22 1.7v9.6H12zM2 12.7h8.5v8L2 19.5zm10 0h10v9.6L12 20.9z" /></svg>
    <svg v-else-if="system.id==='ubuntu'" class="os-logo ubuntu-logo" width="20" height="20" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="12" fill="currentColor" /><g fill="none" stroke="#fff" stroke-width="2.2"><circle cx="12" cy="12" r="5.4" /></g><g fill="#fff" stroke="#e95420" stroke-width="1.5"><circle cx="5.9" cy="12" r="2.1"/><circle cx="15.1" cy="6.6" r="2.1"/><circle cx="15.1" cy="17.4" r="2.1"/></g></svg>
    <svg v-else class="os-logo apple-logo" width="18" height="21" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M17.05 12.54c.03 3.11 2.73 4.14 2.76 4.15-.02.07-.43 1.48-1.42 2.94-.86 1.26-1.76 2.51-3.17 2.54-1.38.03-1.83-.82-3.41-.82-1.57 0-2.07.79-3.38.85-1.36.05-2.39-1.36-3.26-2.61-1.78-2.57-3.14-7.27-1.31-10.45.91-1.58 2.54-2.58 4.31-2.61 1.35-.03 2.62.91 3.44.91.83 0 2.38-1.13 4.01-.96.68.03 2.58.27 3.8 2.06-.1.06-2.28 1.33-2.25 4zm-2.6-7.68c.72-.87 1.2-2.08 1.07-3.29-1.04.04-2.31.69-3.06 1.56-.67.77-1.26 2-1.1 3.18 1.16.09 2.35-.59 3.09-1.45z" /></svg>
    <strong v-if="system.version" aria-hidden="true">{{ system.version }}</strong>
  </span>
  <span v-if="!systems.length" class="lab-icon-fact unknown" role="listitem" :title="os ?? 'Operating system not listed'" :aria-label="`Operating system: ${os ?? 'Not listed'}`"><AppIcon name="monitor" :size="18" /><span>—</span></span>
</template>
