<script setup lang="ts">
import { computed, onMounted, onUnmounted } from 'vue'
import { useWorkersStore } from '../stores/workers'
import StatusBadge from '../components/StatusBadge.vue'

const workersStore = useWorkersStore()

onMounted(() => { void workersStore.fetchWorkers() })

// Auto-refresh every 30s to keep heartbeat ages current
let interval: ReturnType<typeof setInterval> | null = null
onMounted(() => { interval = setInterval(() => { void workersStore.fetchWorkers() }, 30_000) })
onUnmounted(() => { if (interval) clearInterval(interval) })

function sinceHeartbeat(ts: string): string {
  const ms = Date.now() - new Date(ts).getTime()
  const secs = Math.floor(ms / 1000)
  if (secs < 60) return `${secs}s ago`
  const mins = Math.floor(secs / 60)
  if (mins < 60) return `${mins}m ago`
  return `${Math.floor(mins / 60)}h ago`
}

function heartbeatHealth(ts: string): 'healthy' | 'warn' | 'stale' {
  const ms = Date.now() - new Date(ts).getTime()
  if (ms < 60_000) return 'healthy'
  if (ms < 300_000) return 'warn'
  return 'stale'
}

function elapsed(startedAt: string): string {
  const ms = Date.now() - new Date(startedAt).getTime()
  const secs = Math.floor(ms / 1000)
  if (secs < 60) return `${secs}s`
  const mins = Math.floor(secs / 60)
  if (mins < 60) return `${mins}m`
  return `${Math.floor(mins / 60)}h ${mins % 60}m`
}

const hasWorkers = computed(() => workersStore.workers.length > 0)
</script>

<template>
  <div>
    <div class="toolbar">
      <span class="section-title" style="margin-bottom:0">workers</span>
      <button @click="workersStore.fetchWorkers()">refresh</button>
    </div>

    <div v-if="workersStore.loading" class="dim-text">loading...</div>
    <div v-else-if="workersStore.error" class="error-text">{{ workersStore.error }}</div>
    <div v-else-if="!hasWorkers" class="dim-text">no active workers</div>

    <table v-else>
      <thead>
        <tr>
          <th>process</th>
          <th>pid</th>
          <th>job</th>
          <th>status</th>
          <th>heartbeat</th>
          <th>uptime</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="w in workersStore.workers" :key="w.name">
          <td class="mono-name">{{ w.name }}</td>
          <td class="dim-cell">{{ w.pid }}</td>
          <td class="job-col">
            <template v-if="w.job_description">
              <span class="mono-id">{{ (w.job_id ?? '').slice(0, 8) }}</span>
              <span class="job-desc">{{ w.job_description.slice(0, 60) }}</span>
            </template>
            <span v-else class="dim-cell">—</span>
          </td>
          <td>
            <StatusBadge v-if="w.job_status" :status="w.job_status" />
            <span v-else class="dim-cell">—</span>
          </td>
          <td>
            <span :class="['hb-badge', heartbeatHealth(w.last_heartbeat)]">
              {{ sinceHeartbeat(w.last_heartbeat) }}
            </span>
          </td>
          <td class="dim-cell">{{ elapsed(w.started_at) }}</td>
        </tr>
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

.mono-name {
  font-family: var(--font);
  font-size: 11px;
  color: var(--text);
  white-space: nowrap;
}

.mono-id {
  font-family: var(--font);
  font-size: 11px;
  color: var(--dim);
  margin-right: 8px;
}

.job-col {
  max-width: 320px;
}

.job-desc {
  font-size: 12px;
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

.hb-badge {
  font-size: 11px;
  padding: 2px 6px;
  border-radius: 3px;
  white-space: nowrap;
}

.hb-badge.healthy {
  color: var(--green);
  background: color-mix(in srgb, var(--green) 12%, transparent);
}

.hb-badge.warn {
  color: var(--yellow);
  background: color-mix(in srgb, var(--yellow) 12%, transparent);
}

.hb-badge.stale {
  color: var(--red);
  background: color-mix(in srgb, var(--red) 12%, transparent);
}
</style>
