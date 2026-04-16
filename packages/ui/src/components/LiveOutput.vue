<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted, nextTick } from 'vue'
import { useJobsStore, type OutputLine } from '../stores/jobs'

const props = defineProps<{
  jobId: string
  isRunning: boolean
}>()

const jobsStore = useJobsStore()
const lines = ref<OutputLine[]>([])
const container = ref<HTMLElement | null>(null)
let pollInterval: ReturnType<typeof setInterval> | null = null

async function refresh(): Promise<void> {
  await jobsStore.fetchOutput(props.jobId)
  const storeLines = jobsStore.outputMap[props.jobId]
  if (storeLines) {
    lines.value = storeLines
    await nextTick()
    if (container.value) {
      container.value.scrollTop = container.value.scrollHeight
    }
  }
}

function startPolling(): void {
  if (pollInterval !== null) return
  pollInterval = setInterval(() => { void refresh() }, 2000)
}

function stopPolling(): void {
  if (pollInterval !== null) {
    clearInterval(pollInterval)
    pollInterval = null
  }
}

onMounted(async () => {
  await refresh()
  if (props.isRunning) startPolling()
})

watch(() => props.isRunning, (running) => {
  if (running) startPolling()
  else stopPolling()
})

onUnmounted(() => { stopPolling() })
</script>

<template>
  <div ref="container" class="output">
    <div v-if="lines.length === 0" class="empty">no output yet</div>
    <div v-for="(l, i) in lines" :key="i" class="line">{{ l.line }}</div>
  </div>
</template>

<style scoped>
.output {
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 3px;
  padding: 8px 10px;
  max-height: 300px;
  overflow-y: auto;
  font-size: 11px;
  line-height: 1.6;
}

.line {
  white-space: pre-wrap;
  word-break: break-all;
}

.empty {
  color: var(--dim);
}
</style>
