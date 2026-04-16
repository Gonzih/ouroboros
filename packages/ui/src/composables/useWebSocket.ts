import { onMounted, onUnmounted } from 'vue'
import { useJobsStore } from '../stores/jobs'
import { useLogsStore } from '../stores/logs'

interface WsMessage {
  type: 'notify' | 'job_update' | 'job_output' | 'log'
  payload?: unknown
  job?: Record<string, unknown>
  jobId?: string
  line?: string
  entry?: { id: number; source: string; message: string; ts: string }
}

export function useWebSocket(): void {
  let ws: WebSocket | null = null
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null
  let stopped = false

  function connect(): void {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
    ws = new WebSocket(`${proto}//${location.host}/ws`)

    ws.onopen = () => {
      // connection established
    }

    ws.onmessage = (event: MessageEvent<string>) => {
      let msg: WsMessage
      try {
        msg = JSON.parse(event.data) as WsMessage
      } catch {
        return
      }

      const jobsStore = useJobsStore()
      const logsStore = useLogsStore()

      if (msg.type === 'notify' && msg.payload) {
        // A Postgres LISTEN/NOTIFY event — trigger a jobs refresh
        void jobsStore.fetchJobs()
      } else if (msg.type === 'job_update' && msg.job) {
        jobsStore.updateJob(msg.job)
      } else if (msg.type === 'job_output' && msg.jobId && msg.line) {
        jobsStore.appendOutput(msg.jobId, msg.line)
      } else if (msg.type === 'log' && msg.entry) {
        logsStore.prependLog(msg.entry)
      }
    }

    ws.onclose = () => {
      if (!stopped) {
        reconnectTimer = setTimeout(connect, 3000)
      }
    }

    ws.onerror = () => {
      ws?.close()
    }
  }

  onMounted(() => { connect() })

  onUnmounted(() => {
    stopped = true
    if (reconnectTimer !== null) clearTimeout(reconnectTimer)
    ws?.close()
  })
}
