<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useJobsStore } from '../stores/jobs'
import StatusBadge from '../components/StatusBadge.vue'
import LiveOutput from '../components/LiveOutput.vue'

const PAGE_SIZE = 50

const jobsStore = useJobsStore()
const expandedId = ref<string | null>(null)
const cancellingId = ref<string | null>(null)
const retryingId = ref<string | null>(null)
const statusFilter = ref<string>('all')
const offset = ref(0)
const hasMore = ref(false)

const STATUS_FILTERS = ['all', 'pending', 'running', 'completed', 'failed', 'cancelled'] as const

async function loadJobs(reset = true): Promise<void> {
  if (reset) offset.value = 0
  const prevLength = reset ? 0 : jobsStore.jobs.length
  await jobsStore.fetchJobs({ status: statusFilter.value, limit: PAGE_SIZE, offset: offset.value })
  hasMore.value = (jobsStore.jobs.length - prevLength) >= PAGE_SIZE
}

async function loadMore(): Promise<void> {
  offset.value += PAGE_SIZE
  await loadJobs(false)
}

async function applyFilter(f: string): Promise<void> {
  statusFilter.value = f
  await loadJobs(true)
}

onMounted(() => { void loadJobs() })

function toggle(id: string): void {
  expandedId.value = expandedId.value === id ? null : id
}

async function cancelJob(id: string, event: Event): Promise<void> {
  event.stopPropagation()
  cancellingId.value = id
  try {
    await jobsStore.cancelJob(id)
  } catch (err: unknown) {
    alert(String(err))
  } finally {
    cancellingId.value = null
  }
}

async function retryJob(id: string, event: Event): Promise<void> {
  event.stopPropagation()
  retryingId.value = id
  try {
    await jobsStore.retryJob(id)
  } catch (err: unknown) {
    alert(String(err))
  } finally {
    retryingId.value = null
  }
}

function elapsed(job: { started_at: string | null; completed_at: string | null; status: string }): string {
  const start = job.started_at ? new Date(job.started_at).getTime() : null
  if (!start) return '—'
  const end = job.completed_at ? new Date(job.completed_at).getTime() : Date.now()
  const secs = Math.floor((end - start) / 1000)
  if (secs < 60) return `${secs}s`
  return `${Math.floor(secs / 60)}m ${secs % 60}s`
}
</script>

<template>
  <div>
    <div class="toolbar">
      <span class="section-title" style="margin-bottom:0">jobs</span>
      <div class="filters">
        <button
          v-for="f in STATUS_FILTERS"
          :key="f"
          :class="{ active: statusFilter === f }"
          @click="applyFilter(f)"
        >{{ f }}</button>
      </div>
      <button @click="loadJobs()">refresh</button>
    </div>

    <div v-if="jobsStore.loading && offset === 0" class="dim-text">loading...</div>
    <div v-else-if="jobsStore.error" class="error-text">{{ jobsStore.error }}</div>
    <div v-else-if="jobsStore.jobs.length === 0" class="dim-text">no jobs</div>

    <table v-else>
      <thead>
        <tr>
          <th>id</th>
          <th>description</th>
          <th>backend</th>
          <th>status</th>
          <th>created</th>
          <th>elapsed</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        <template v-for="job in jobsStore.jobs" :key="job.id">
          <tr class="job-row" @click="toggle(job.id)">
            <td class="mono-id">{{ job.id.slice(0, 8) }}</td>
            <td class="description">{{ job.description.slice(0, 80) }}</td>
            <td class="dim-cell">{{ job.backend }}</td>
            <td><StatusBadge :status="job.status" /></td>
            <td class="dim-cell">{{ new Date(job.created_at).toLocaleString() }}</td>
            <td class="dim-cell">{{ elapsed(job) }}</td>
            <td class="action-cell">
              <button
                v-if="job.status === 'running' || job.status === 'pending'"
                class="cancel-btn"
                :disabled="cancellingId === job.id"
                @click="cancelJob(job.id, $event)"
              >
                {{ cancellingId === job.id ? '…' : 'cancel' }}
              </button>
              <button
                v-if="job.status === 'failed' || job.status === 'cancelled'"
                class="retry-btn"
                :disabled="retryingId === job.id"
                @click="retryJob(job.id, $event)"
              >
                {{ retryingId === job.id ? '…' : 'retry' }}
              </button>
            </td>
          </tr>
          <tr v-if="expandedId === job.id" class="output-row">
            <td colspan="7">
              <LiveOutput :job-id="job.id" :is-running="job.status === 'running'" />
              <div v-if="job.error" class="error-text" style="margin-top:6px">error: {{ job.error }}</div>
            </td>
          </tr>
        </template>
      </tbody>
    </table>

    <div v-if="hasMore" class="load-more">
      <button :disabled="jobsStore.loading" @click="loadMore()">
        {{ jobsStore.loading ? 'loading…' : 'load more' }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 14px;
  flex-wrap: wrap;
}

.filters {
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
}

.filters button.active {
  border-color: var(--accent);
  color: var(--accent);
}

.mono-id {
  font-family: var(--font);
  color: var(--dim);
  font-size: 11px;
  white-space: nowrap;
}

.description {
  max-width: 300px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dim-cell {
  color: var(--dim);
  font-size: 11px;
}

.action-cell {
  display: flex;
  gap: 4px;
}

.job-row {
  cursor: pointer;
}

.output-row td {
  padding: 8px 10px;
  background: var(--surface);
}

.cancel-btn {
  border-color: var(--red);
  color: var(--red);
  font-size: 11px;
  padding: 2px 8px;
}

.cancel-btn:hover:not(:disabled) {
  background: color-mix(in srgb, var(--red) 15%, transparent);
}

.retry-btn {
  border-color: var(--accent);
  color: var(--accent);
  font-size: 11px;
  padding: 2px 8px;
}

.retry-btn:hover:not(:disabled) {
  background: color-mix(in srgb, var(--accent) 15%, transparent);
}

.dim-text {
  color: var(--dim);
  font-size: 12px;
}

.load-more {
  margin-top: 10px;
  text-align: center;
}
</style>
