<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed } from 'vue'
import { useJobsStore } from '../stores/jobs'
import { useLogsStore } from '../stores/logs'
import { useMcpStore } from '../stores/mcp'
import StatusBadge from '../components/StatusBadge.vue'

const jobsStore = useJobsStore()
const logsStore = useLogsStore()
const mcpStore = useMcpStore()

const taskInstructions = ref('')
const taskBackend = ref('git')
const taskTarget = ref('')
const taskError = ref<string | null>(null)
const taskSubmitting = ref(false)

const recentLogs = computed(() => logsStore.logs.slice(0, 20))
const runningJobs = computed(() => jobsStore.jobs.filter(j => j.status === 'running'))
const activeMcps = computed(() => mcpStore.mcps.filter(m => m.status === 'operational'))

let refreshInterval: ReturnType<typeof setInterval> | null = null

onMounted(async () => {
  await Promise.all([jobsStore.fetchJobs(), logsStore.fetchLogs(), mcpStore.fetchMcp()])
  refreshInterval = setInterval(() => {
    void jobsStore.fetchJobs()
    void logsStore.fetchLogs()
  }, 10000)
})

onUnmounted(() => {
  if (refreshInterval !== null) clearInterval(refreshInterval)
})

async function submitTask(): Promise<void> {
  if (!taskInstructions.value.trim() || !taskTarget.value.trim()) return
  taskError.value = null
  taskSubmitting.value = true
  try {
    await jobsStore.submitTask(taskInstructions.value.trim(), taskBackend.value, taskTarget.value.trim())
    taskInstructions.value = ''
    taskTarget.value = ''
  } catch (err: unknown) {
    taskError.value = String(err)
  } finally {
    taskSubmitting.value = false
  }
}
</script>

<template>
  <div class="dashboard">
    <div class="stats-row">
      <div class="card stat">
        <div class="stat-value">{{ runningJobs.length }}</div>
        <div class="stat-label">running jobs</div>
      </div>
      <div class="card stat">
        <div class="stat-value">{{ activeMcps.length }}</div>
        <div class="stat-label">active mcps</div>
      </div>
      <div class="card stat">
        <div class="stat-value">{{ jobsStore.jobs.length }}</div>
        <div class="stat-label">total jobs</div>
      </div>
    </div>

    <div class="grid">
      <div class="card">
        <div class="section-title">submit task</div>
        <div class="form-row">
          <textarea
            v-model="taskInstructions"
            placeholder="instructions..."
            rows="3"
            class="full-width"
          />
        </div>
        <div class="form-row inline">
          <select v-model="taskBackend">
            <option value="git">git</option>
            <option value="local">local</option>
            <option value="s3">s3</option>
            <option value="gdrive">gdrive</option>
            <option value="onedrive">onedrive</option>
          </select>
          <input v-model="taskTarget" placeholder="target (repo url, path, bucket)" class="flex-1" />
          <button :disabled="taskSubmitting || !taskInstructions.trim() || !taskTarget.trim()" @click="submitTask">
            {{ taskSubmitting ? 'submitting...' : 'run' }}
          </button>
        </div>
        <div v-if="taskError" class="error-text">{{ taskError }}</div>
      </div>

      <div class="card">
        <div class="section-title">running jobs</div>
        <div v-if="runningJobs.length === 0" class="empty">no jobs running</div>
        <table v-else>
          <tbody>
            <tr v-for="job in runningJobs" :key="job.id">
              <td class="mono-id">{{ job.id.slice(0, 8) }}</td>
              <td>{{ job.description.slice(0, 60) }}</td>
              <td><StatusBadge :status="job.status" /></td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <div class="card log-card">
      <div class="section-title">recent logs</div>
      <div class="log-stream">
        <div v-if="recentLogs.length === 0" class="empty">no logs</div>
        <div v-for="entry in recentLogs" :key="entry.id" class="log-line">
          <span class="log-ts">{{ new Date(entry.ts).toLocaleTimeString() }}</span>
          <span class="log-src">[{{ entry.source }}]</span>
          <span class="log-msg">{{ entry.message }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.dashboard {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.stats-row {
  display: flex;
  gap: 12px;
}

.stat {
  flex: 1;
  text-align: center;
}

.stat-value {
  font-size: 28px;
  font-weight: 700;
  color: var(--accent);
}

.stat-label {
  font-size: 11px;
  color: var(--dim);
  margin-top: 4px;
}

.grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
}

.form-row {
  margin-bottom: 8px;
}

.form-row.inline {
  display: flex;
  gap: 8px;
  align-items: flex-start;
}

.full-width {
  width: 100%;
  resize: vertical;
}

.flex-1 {
  flex: 1;
}

.mono-id {
  font-family: var(--font);
  color: var(--dim);
  font-size: 11px;
}

.log-card {
  flex: 1;
}

.log-stream {
  max-height: 240px;
  overflow-y: auto;
}

.log-line {
  display: flex;
  gap: 8px;
  font-size: 11px;
  line-height: 1.7;
  border-bottom: 1px solid var(--border);
  padding: 1px 0;
}

.log-ts {
  color: var(--dim);
  white-space: nowrap;
  flex-shrink: 0;
}

.log-src {
  color: var(--accent);
  white-space: nowrap;
  flex-shrink: 0;
}

.log-msg {
  word-break: break-word;
}

.empty {
  color: var(--dim);
  font-size: 12px;
  padding: 8px 0;
}
</style>
