import { ref } from 'vue'
import { defineStore } from 'pinia'

export interface WorkerRow {
  name: string
  pid: number
  started_at: string
  last_heartbeat: string
  job_id: string | null
  job_description: string | null
  job_status: string | null
}

export const useWorkersStore = defineStore('workers', () => {
  const workers = ref<WorkerRow[]>([])
  const loading = ref(false)
  const error = ref<string | null>(null)

  async function fetchWorkers(): Promise<void> {
    loading.value = true
    error.value = null
    try {
      const res = await fetch('/api/workers')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      workers.value = (await res.json()) as WorkerRow[]
    } catch (err: unknown) {
      error.value = String(err)
    } finally {
      loading.value = false
    }
  }

  return { workers, loading, error, fetchWorkers }
})
