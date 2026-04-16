import { ref } from 'vue'
import { defineStore } from 'pinia'

export interface JobRow {
  id: string
  description: string
  backend: string
  target: string
  status: string
  created_at: string
  started_at: string | null
  completed_at: string | null
  error: string | null
}

export interface OutputLine {
  line: string
  ts: string
}

export const useJobsStore = defineStore('jobs', () => {
  const jobs = ref<JobRow[]>([])
  const loading = ref(false)
  const error = ref<string | null>(null)
  // jobId → output lines (for expanded view)
  const outputMap = ref<Record<string, OutputLine[]>>({})

  async function fetchJobs(): Promise<void> {
    loading.value = true
    error.value = null
    try {
      const res = await fetch('/api/jobs')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      jobs.value = (await res.json()) as JobRow[]
    } catch (err: unknown) {
      error.value = String(err)
    } finally {
      loading.value = false
    }
  }

  async function fetchOutput(jobId: string): Promise<void> {
    try {
      const res = await fetch(`/api/jobs/${jobId}/output`)
      if (!res.ok) return
      outputMap.value[jobId] = (await res.json()) as OutputLine[]
    } catch {
      // swallow
    }
  }

  async function submitTask(instructions: string, backend: string, target: string): Promise<void> {
    const res = await fetch('/api/task', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ instructions, backend, target })
    })
    if (!res.ok) {
      const data = (await res.json()) as { error?: string }
      throw new Error(data.error ?? 'Failed to submit task')
    }
    await fetchJobs()
  }

  function updateJob(partial: Record<string, unknown>): void {
    const id = partial['id']
    if (typeof id !== 'string') return
    const idx = jobs.value.findIndex(j => j.id === id)
    if (idx >= 0) {
      const existing = jobs.value[idx]
      if (existing) {
        jobs.value[idx] = { ...existing, ...(partial as Partial<JobRow>) }
      }
    }
  }

  function appendOutput(jobId: string, line: string): void {
    const existing = outputMap.value[jobId]
    if (existing) {
      existing.push({ line, ts: new Date().toISOString() })
    }
  }

  return { jobs, loading, error, outputMap, fetchJobs, fetchOutput, submitTask, updateJob, appendOutput }
})
