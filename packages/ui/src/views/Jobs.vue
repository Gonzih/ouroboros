<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useJobsStore } from '../stores/jobs'
import StatusBadge from '../components/StatusBadge.vue'
import LiveOutput from '../components/LiveOutput.vue'

const jobsStore = useJobsStore()
const expandedId = ref<string | null>(null)

onMounted(() => { void jobsStore.fetchJobs() })

function toggle(id: string): void {
  expandedId.value = expandedId.value === id ? null : id
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
      <button @click="jobsStore.fetchJobs()">refresh</button>
    </div>

    <div v-if="jobsStore.loading" class="dim-text">loading...</div>
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
          </tr>
          <tr v-if="expandedId === job.id" class="output-row">
            <td colspan="6">
              <LiveOutput :job-id="job.id" :is-running="job.status === 'running'" />
              <div v-if="job.error" class="error-text" style="margin-top:6px">error: {{ job.error }}</div>
            </td>
          </tr>
        </template>
      </tbody>
    </table>
  </div>
</template>

<style scoped>
.toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 14px;
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

.job-row {
  cursor: pointer;
}

.output-row td {
  padding: 8px 10px;
  background: var(--surface);
}

.dim-text {
  color: var(--dim);
  font-size: 12px;
}
</style>
