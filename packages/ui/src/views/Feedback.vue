<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useFeedbackStore } from '../stores/feedback'
import StatusBadge from '../components/StatusBadge.vue'

const feedbackStore = useFeedbackStore()
const text = ref('')
const submitError = ref<string | null>(null)
const submitSuccess = ref(false)
const actioningId = ref<string | null>(null)
const actionError = ref<string | null>(null)

onMounted(() => { void feedbackStore.fetchFeedback() })

async function submit(): Promise<void> {
  if (!text.value.trim()) return
  submitError.value = null
  submitSuccess.value = false
  try {
    await feedbackStore.submitFeedback(text.value.trim())
    text.value = ''
    submitSuccess.value = true
    setTimeout(() => { submitSuccess.value = false }, 3000)
  } catch (err: unknown) {
    submitError.value = String(err)
  }
}

async function approve(id: string): Promise<void> {
  actioningId.value = id
  actionError.value = null
  try {
    await feedbackStore.approveFeedback(id)
  } catch (err: unknown) {
    actionError.value = String(err)
  } finally {
    actioningId.value = null
  }
}

async function reject(id: string): Promise<void> {
  actioningId.value = id
  actionError.value = null
  try {
    await feedbackStore.rejectFeedback(id)
  } catch (err: unknown) {
    actionError.value = String(err)
  } finally {
    actioningId.value = null
  }
}
</script>

<template>
  <div>
    <div class="section-title">submit feedback</div>

    <div class="card submit-card">
      <div class="warning-banner">
        Submitting feedback triggers code changes to Ouroboros. You will receive a diff to approve.
      </div>
      <textarea
        v-model="text"
        placeholder="describe the change you want..."
        rows="5"
        class="full-width"
      />
      <div class="submit-row">
        <button
          :disabled="feedbackStore.submitting || !text.trim()"
          @click="submit"
        >
          {{ feedbackStore.submitting ? 'submitting...' : 'submit feedback' }}
        </button>
        <span v-if="submitSuccess" class="success-text">feedback submitted</span>
        <span v-if="submitError" class="error-text">{{ submitError }}</span>
      </div>
    </div>

    <div class="section-title" style="margin-top:24px">history</div>
    <div v-if="feedbackStore.loading" class="dim-text">loading...</div>
    <div v-else-if="feedbackStore.error" class="error-text">{{ feedbackStore.error }}</div>
    <div v-else-if="feedbackStore.feedbacks.length === 0" class="dim-text">no feedback submitted yet</div>
    <template v-else>
    <div v-if="actionError" class="error-text" style="margin-bottom:8px">{{ actionError }}</div>
    <table>
      <thead>
        <tr>
          <th>id</th>
          <th>text</th>
          <th>status</th>
          <th>pr</th>
          <th>submitted</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="fb in feedbackStore.feedbacks" :key="fb.id">
          <td class="mono-id">{{ fb.id.slice(0, 8) }}</td>
          <td class="fb-text">{{ fb.text.slice(0, 100) }}</td>
          <td><StatusBadge :status="fb.status" /></td>
          <td>
            <a v-if="fb.pr_url" :href="fb.pr_url" target="_blank" rel="noopener">view pr</a>
            <span v-else class="dim-text">—</span>
          </td>
          <td class="dim-cell">{{ new Date(fb.created_at).toLocaleString() }}</td>
          <td class="action-cell">
            <template v-if="fb.status === 'pr_open' || fb.status === 'merge_failed'">
              <button
                class="approve-btn"
                :disabled="actioningId === fb.id"
                @click="approve(fb.id)"
              >{{ actioningId === fb.id ? '…' : 'approve' }}</button>
              <button
                class="danger-btn"
                :disabled="actioningId === fb.id"
                @click="reject(fb.id)"
              >reject</button>
            </template>
          </td>
        </tr>
      </tbody>
    </table>
    </template>
  </div>
</template>

<style scoped>
.submit-card {
  margin-bottom: 8px;
}

.warning-banner {
  background: color-mix(in srgb, var(--yellow) 10%, transparent);
  border: 1px solid color-mix(in srgb, var(--yellow) 30%, transparent);
  color: var(--yellow);
  border-radius: 3px;
  padding: 8px 12px;
  font-size: 12px;
  margin-bottom: 12px;
}

.full-width {
  width: 100%;
  resize: vertical;
  margin-bottom: 10px;
}

.submit-row {
  display: flex;
  align-items: center;
  gap: 12px;
}

.success-text {
  color: var(--green);
  font-size: 12px;
}

.mono-id {
  font-family: var(--font);
  color: var(--dim);
  font-size: 11px;
  white-space: nowrap;
}

.fb-text {
  max-width: 320px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dim-cell {
  color: var(--dim);
  font-size: 11px;
}

.dim-text {
  color: var(--dim);
  font-size: 12px;
}

.action-cell {
  display: flex;
  gap: 6px;
}

.approve-btn {
  border-color: var(--green);
  color: var(--green);
  font-size: 11px;
  padding: 2px 8px;
}

.approve-btn:hover {
  background: color-mix(in srgb, var(--green) 15%, transparent);
}

.danger-btn {
  border-color: var(--red);
  color: var(--red);
  font-size: 11px;
  padding: 2px 8px;
}

.danger-btn:hover {
  background: color-mix(in srgb, var(--red) 15%, transparent);
}
</style>
