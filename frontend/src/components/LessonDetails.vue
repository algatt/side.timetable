<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import type { Entry } from '../lib/timetable'
import { sourceUrl, subjectTone } from '../lib/timetable'
import AppIcon from './AppIcon.vue'
import LabInfo from './LabInfo.vue'
import type { LabInventory } from '../lib/labs'

const props = defineProps<{ entry: Entry; pdfUrl: string | null; labInventory?: LabInventory }>()
const emit = defineEmits<{ close: [] }>()
const dialog = ref<HTMLDialogElement>()
const originalPage = computed(() => sourceUrl(props.pdfUrl, props.entry.source_page))
const labs = computed(() => props.labInventory?.rooms.filter(lab => props.entry.rooms.includes(lab.room)) ?? [])
onMounted(() => dialog.value?.showModal())
function close() { dialog.value?.close() }
function backdrop(event: MouseEvent) { if (event.target === dialog.value) close() }
</script>

<template>
  <dialog ref="dialog" class="lesson-dialog" aria-labelledby="lesson-title" @close="emit('close')" @click="backdrop">
    <div class="dialog-top"><button class="icon-button" type="button" aria-label="Close lesson details" @click="close"><AppIcon name="close" /></button></div>
    <span class="subject-chip" :class="`tone-${subjectTone(entry)}`">{{ entry.subject_code || 'No code printed' }}</span>
    <h2 id="lesson-title">{{ entry.subject_name }}</h2>
    <p class="dialog-group">{{ entry.group }}</p>
    <p v-if="entry.shared_groups && entry.shared_groups.length>1" class="dialog-shared-groups"><AppIcon name="seats" :size="15" /><span>Shared groups: {{ entry.shared_groups.join(' · ') }}</span></p>
    <dl class="lesson-facts">
      <div><dt><AppIcon name="calendar" /> Day</dt><dd>{{ entry.weekday }}</dd></div>
      <div><dt><AppIcon name="clock" /> Time</dt><dd>{{ entry.start }} – {{ entry.end }} <small>Malta time</small></dd></div>
      <div><dt><AppIcon name="book" /> Duration</dt><dd>{{ entry.duration_minutes }} minutes</dd></div>
      <div><dt><AppIcon name="room" /> {{ entry.rooms.length > 1 ? 'Rooms' : 'Room' }}</dt><dd>{{ entry.rooms.join(' · ') || 'Not specified in the PDF' }}</dd></div>
    </dl>
    <section v-if="labs.length" class="lesson-lab-details" aria-label="Room equipment and capacity"><h3>Room information</h3><div v-for="lab in labs" :key="lab.room"><h4>{{ lab.room }}</h4><LabInfo :lab="lab" /></div></section>
    <div v-if="entry.notes.length" class="source-notes"><strong><AppIcon name="info" /> From the source timetable</strong><p v-for="note in entry.notes" :key="note">{{ note }}</p></div>
    <details class="raw-source"><summary>Show original PDF text</summary><pre>{{ entry.raw_text }}</pre></details>
    <a v-if="originalPage" :href="originalPage" target="_blank" rel="noopener noreferrer" class="primary-button source-page">Open PDF · page {{ entry.source_page }}<AppIcon name="arrow" /></a>
    <p v-else class="muted">Source: PDF page {{ entry.source_page }}</p>
  </dialog>
</template>
