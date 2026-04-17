import { ref } from 'vue'
import { defineStore } from 'pinia'

export interface FeedbackRow {
  id: string
  source: string
  text: string
  status: string
  pr_url: string | null
  created_at: string
}

export const useFeedbackStore = defineStore('feedback', () => {
  const feedbacks = ref<FeedbackRow[]>([])
  const loading = ref(false)
  const submitting = ref(false)
  const error = ref<string | null>(null)

  async function fetchFeedback(): Promise<void> {
    loading.value = true
    error.value = null
    try {
      const res = await fetch('/api/feedback')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      feedbacks.value = (await res.json()) as FeedbackRow[]
    } catch (err: unknown) {
      error.value = String(err)
    } finally {
      loading.value = false
    }
  }

  async function submitFeedback(text: string): Promise<void> {
    submitting.value = true
    error.value = null
    try {
      const res = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text })
      })
      if (!res.ok) {
        const data = (await res.json()) as { error?: string }
        throw new Error(data.error ?? 'Failed to submit feedback')
      }
      await fetchFeedback()
    } catch (err: unknown) {
      error.value = String(err)
      throw err
    } finally {
      submitting.value = false
    }
  }

  async function approveFeedback(id: string): Promise<void> {
    const res = await fetch(`/api/feedback/${id}/approve`, { method: 'POST' })
    if (!res.ok) {
      const data = (await res.json()) as { error?: string }
      throw new Error(data.error ?? 'Failed to approve')
    }
    await fetchFeedback()
  }

  async function rejectFeedback(id: string, reason?: string): Promise<void> {
    const res = await fetch(`/api/feedback/${id}/reject`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason })
    })
    if (!res.ok) {
      const data = (await res.json()) as { error?: string }
      throw new Error(data.error ?? 'Failed to reject')
    }
    await fetchFeedback()
  }

  return { feedbacks, loading, submitting, error, fetchFeedback, submitFeedback, approveFeedback, rejectFeedback }
})
