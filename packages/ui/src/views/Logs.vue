<script setup lang="ts">
import { onMounted, onUnmounted } from 'vue'
import { useLogsStore } from '../stores/logs'

const logsStore = useLogsStore()

let refreshInterval: ReturnType<typeof setInterval> | null = null

onMounted(async () => {
  await logsStore.fetchLogs()
  refreshInterval = setInterval(() => { void logsStore.fetchLogs() }, 5000)
})

onUnmounted(() => {
  if (refreshInterval !== null) clearInterval(refreshInterval)
})
</script>

<template>
  <div>
    <div class="toolbar">
      <span class="section-title" style="margin-bottom:0">logs</span>
      <div class="filters">
        <button
          :class="{ active: logsStore.sourceFilter === 'all' }"
          @click="logsStore.sourceFilter = 'all'"
        >all</button>
        <button
          v-for="src in logsStore.sources"
          :key="src"
          :class="{ active: logsStore.sourceFilter === src }"
          @click="logsStore.sourceFilter = src"
        >{{ src }}</button>
      </div>
      <button @click="logsStore.fetchLogs()">refresh</button>
    </div>

    <div v-if="logsStore.loading" class="dim-text">loading...</div>
    <div v-else-if="logsStore.error" class="error-text">{{ logsStore.error }}</div>
    <div v-else class="log-stream">
      <div v-if="logsStore.filteredLogs.length === 0" class="dim-text">no logs</div>
      <div v-for="entry in logsStore.filteredLogs" :key="entry.id" class="log-line">
        <span class="log-ts">{{ new Date(entry.ts).toLocaleString() }}</span>
        <span class="log-src">[{{ entry.source }}]</span>
        <span class="log-msg">{{ entry.message }}</span>
      </div>
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

.log-stream {
  font-size: 11px;
  line-height: 1.7;
}

.log-line {
  display: flex;
  gap: 8px;
  border-bottom: 1px solid var(--border);
  padding: 2px 0;
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
  flex: 1;
}

.dim-text {
  color: var(--dim);
  font-size: 12px;
}
</style>
