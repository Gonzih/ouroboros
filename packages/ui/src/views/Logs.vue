<script setup lang="ts">
import { ref, computed, nextTick, onMounted, onUnmounted } from 'vue'

interface LogEntry {
  id: number
  source: string
  message: string
  ts: string
}

const SOURCE_COLORS: Record<string, string> = {
  'coordinator': '#ffc107',
  'watchdog': '#2196f3',
  'worker': '#4caf50',
  'meta-agent': '#7c3aed',
  'evolution': '#ff9800',
  'scheduler': '#00bcd4',
  'mcp-watch': '#e91e63',
}

function sourceColor(source: string): string {
  if (source.endsWith(':err') || source.includes('error')) return 'var(--red)'
  return SOURCE_COLORS[source] ?? 'var(--dim)'
}

const logs = ref<LogEntry[]>([])
const paused = ref(false)
const sourceFilter = ref<string>('all')
const connected = ref(false)
const scrollEl = ref<HTMLElement | null>(null)

const sources = computed(() => {
  const set = new Set(logs.value.map(l => l.source))
  return Array.from(set).sort()
})

const filteredLogs = computed(() => {
  if (sourceFilter.value === 'all') return logs.value
  return logs.value.filter(l => l.source === sourceFilter.value)
})

let es: EventSource | null = null

function scrollToBottom(): void {
  if (scrollEl.value) {
    scrollEl.value.scrollTop = scrollEl.value.scrollHeight
  }
}

function connect(): void {
  if (es) {
    es.close()
    es = null
  }
  connected.value = false
  logs.value = []

  es = new EventSource('/api/logs/stream')

  es.onopen = () => {
    connected.value = true
  }

  es.onmessage = (event: MessageEvent) => {
    const data = JSON.parse(event.data as string) as LogEntry | LogEntry[]
    if (Array.isArray(data)) {
      // Initial batch arrives oldest-first — display as-is (bottom = newest)
      logs.value = data
    } else {
      logs.value.push(data)
      // Cap at 2000 entries to avoid unbounded growth
      if (logs.value.length > 2000) {
        logs.value.splice(0, logs.value.length - 2000)
      }
    }
    if (!paused.value) {
      void nextTick(scrollToBottom)
    }
  }

  es.onerror = () => {
    connected.value = false
    // EventSource reconnects automatically
  }
}

function togglePause(): void {
  paused.value = !paused.value
  if (!paused.value) {
    void nextTick(scrollToBottom)
  }
}

onMounted(() => { connect() })

onUnmounted(() => {
  if (es) {
    es.close()
    es = null
  }
})
</script>

<template>
  <div class="logs-page">
    <div class="toolbar">
      <span class="section-title" style="margin-bottom:0">logs</span>
      <span class="status-dot" :class="{ connected }" :title="connected ? 'connected' : 'reconnecting…'"></span>
      <div class="filters">
        <button
          :class="{ active: sourceFilter === 'all' }"
          @click="sourceFilter = 'all'"
        >all</button>
        <button
          v-for="src in sources"
          :key="src"
          :class="{ active: sourceFilter === src }"
          :style="sourceFilter === src ? { borderColor: sourceColor(src), color: sourceColor(src) } : {}"
          @click="sourceFilter = src"
        >{{ src }}</button>
      </div>
      <button @click="togglePause" :class="{ active: paused }">{{ paused ? 'resume' : 'pause' }}</button>
      <button @click="connect">reconnect</button>
      <span class="entry-count dim-text">{{ filteredLogs.length }} entries</span>
    </div>

    <div class="log-stream" ref="scrollEl">
      <div v-if="filteredLogs.length === 0" class="dim-text">no logs</div>
      <div v-for="entry in filteredLogs" :key="entry.id" class="log-line">
        <span class="log-ts">{{ new Date(entry.ts).toLocaleString() }}</span>
        <span class="log-src" :style="{ color: sourceColor(entry.source) }">[{{ entry.source }}]</span>
        <span class="log-msg">{{ entry.message }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.logs-page {
  display: flex;
  flex-direction: column;
  height: calc(100vh - 44px - 40px);
}

.toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 12px;
  flex-wrap: wrap;
  flex-shrink: 0;
}

.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--dim);
  flex-shrink: 0;
  transition: background 0.3s;
}

.status-dot.connected {
  background: var(--green);
}

.filters {
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
}

button.active {
  border-color: var(--accent);
  color: var(--accent);
}

.entry-count {
  margin-left: auto;
  font-size: 11px;
}

.log-stream {
  flex: 1;
  overflow-y: auto;
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
  padding: 8px 0;
}
</style>
