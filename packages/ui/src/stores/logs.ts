import { ref, computed } from 'vue'
import { defineStore } from 'pinia'

export interface LogEntry {
  id: number
  source: string
  message: string
  ts: string
}

export const useLogsStore = defineStore('logs', () => {
  const logs = ref<LogEntry[]>([])
  const loading = ref(false)
  const error = ref<string | null>(null)
  const sourceFilter = ref<string>('all')

  const filteredLogs = computed(() => {
    if (sourceFilter.value === 'all') return logs.value
    return logs.value.filter(l => l.source === sourceFilter.value)
  })

  const sources = computed(() => {
    const set = new Set(logs.value.map(l => l.source))
    return Array.from(set).sort()
  })

  async function fetchLogs(): Promise<void> {
    loading.value = true
    error.value = null
    try {
      const res = await fetch('/api/logs')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      logs.value = (await res.json()) as LogEntry[]
    } catch (err: unknown) {
      error.value = String(err)
    } finally {
      loading.value = false
    }
  }

  function prependLog(entry: LogEntry): void {
    logs.value.unshift(entry)
    // cap at 500
    if (logs.value.length > 500) logs.value.splice(500)
  }

  return { logs, loading, error, sourceFilter, filteredLogs, sources, fetchLogs, prependLog }
})
