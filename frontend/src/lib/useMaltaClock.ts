import { computed, onBeforeUnmount, ref } from 'vue'
import { maltaNow } from './insights'
export function useMaltaClock() {
  const now = ref(new Date())
  const refresh = () => { now.value = new Date() }
  const timer = window.setInterval(refresh, 30000)
  window.addEventListener('focus', refresh)
  onBeforeUnmount(() => { window.clearInterval(timer); window.removeEventListener('focus', refresh) })
  return { now, local: computed(() => maltaNow(now.value)) }
}
