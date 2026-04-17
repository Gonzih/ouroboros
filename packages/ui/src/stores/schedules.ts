import { ref } from 'vue'
import { defineStore } from 'pinia'

export interface ScheduleRow {
  id: string
  name: string
  cron_expr: string
  backend: string
  target: string
  instructions: string
  enabled: boolean
  last_run_at: string | null
  next_run_at: string | null
  created_at: string
}

export const useSchedulesStore = defineStore('schedules', () => {
  const schedules = ref<ScheduleRow[]>([])
  const loading = ref(false)
  const error = ref<string | null>(null)

  async function fetchSchedules(): Promise<void> {
    loading.value = true
    error.value = null
    try {
      const res = await fetch('/api/schedules')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      schedules.value = (await res.json()) as ScheduleRow[]
    } catch (err: unknown) {
      error.value = String(err)
    } finally {
      loading.value = false
    }
  }

  async function createSchedule(payload: {
    name: string
    cron_expr: string
    backend: string
    target: string
    instructions: string
  }): Promise<void> {
    const res = await fetch('/api/schedules', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    if (!res.ok) {
      const data = (await res.json()) as { error?: string }
      throw new Error(data.error ?? 'Failed to create schedule')
    }
    await fetchSchedules()
  }

  async function toggleSchedule(id: string): Promise<void> {
    const res = await fetch(`/api/schedules/${id}/toggle`, { method: 'PATCH' })
    if (!res.ok) {
      const data = (await res.json()) as { error?: string }
      throw new Error(data.error ?? 'Failed to toggle schedule')
    }
    const data = (await res.json()) as { enabled: boolean }
    const idx = schedules.value.findIndex(s => s.id === id)
    if (idx >= 0) {
      const s = schedules.value[idx]
      if (s) schedules.value[idx] = { ...s, enabled: data.enabled }
    }
  }

  async function updateSchedule(
    id: string,
    payload: Partial<Pick<ScheduleRow, 'name' | 'cron_expr' | 'backend' | 'target' | 'instructions'>>,
  ): Promise<void> {
    const res = await fetch(`/api/schedules/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    if (!res.ok) {
      const data = (await res.json()) as { error?: string }
      throw new Error(data.error ?? 'Failed to update schedule')
    }
    await fetchSchedules()
  }

  async function deleteSchedule(id: string): Promise<void> {
    const res = await fetch(`/api/schedules/${id}`, { method: 'DELETE' })
    if (!res.ok) {
      const data = (await res.json()) as { error?: string }
      throw new Error(data.error ?? 'Failed to delete schedule')
    }
    schedules.value = schedules.value.filter(s => s.id !== id)
  }

  return { schedules, loading, error, fetchSchedules, createSchedule, updateSchedule, toggleSchedule, deleteSchedule }
})
