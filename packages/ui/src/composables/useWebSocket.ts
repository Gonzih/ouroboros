import { onMounted, onUnmounted } from 'vue'
import { useJobsStore } from '../stores/jobs'
import { useLogsStore } from '../stores/logs'
import { useMcpStore } from '../stores/mcp'
import { useFeedbackStore } from '../stores/feedback'

interface NotifyPayload {
  type: string
  jobId?: string
  status?: string
  name?: string
  feedbackId?: string
}

interface WsMessage {
  type: 'notify' | 'job_update' | 'job_output' | 'log'
  payload?: NotifyPayload
  job?: Record<string, unknown>
  jobId?: string
  line?: string
  entry?: { id: number; source: string; message: string; ts: string }
}

const JOB_EVENT_TYPES = new Set([
  'job_complete', 'job_requeued', 'job_cancel_requested',
  'rebuilding', 'rebuild_failed', 'restarting',
])
const MCP_EVENT_TYPES = new Set(['mcp_registered', 'mcp_removed', 'mcp_revalidated'])
const FEEDBACK_EVENT_TYPES = new Set([
  'evolution_approved', 'evolution_rejected', 'evolution_applied',
])

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
      const mcpStore = useMcpStore()
      const feedbackStore = useFeedbackStore()

      if (msg.type === 'notify' && msg.payload) {
        const eventType = msg.payload.type
        if (MCP_EVENT_TYPES.has(eventType)) {
          void mcpStore.fetchMcp()
        } else if (FEEDBACK_EVENT_TYPES.has(eventType)) {
          void feedbackStore.fetchFeedback()
        } else if (JOB_EVENT_TYPES.has(eventType)) {
          void jobsStore.fetchJobs()
        } else {
          // Unknown event — refresh jobs as safe default
          void jobsStore.fetchJobs()
        }
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
