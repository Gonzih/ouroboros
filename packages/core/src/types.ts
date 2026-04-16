// Shared domain types — all packages import from here

export type JobStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'
export type StorageBackend = 'git' | 'local' | 's3' | 'gdrive' | 'onedrive'
export type McpStatus = 'pending' | 'operational' | 'partial' | 'failed'
export type FeedbackStatus = 'pending' | 'pr_open' | 'approved' | 'rejected' | 'applied' | 'merge_failed'

export interface Job {
  id: string
  description: string
  backend: StorageBackend
  target: string
  status: JobStatus
  createdAt: Date
  startedAt?: Date
  completedAt?: Date
  error?: string
  pid?: number
  sessionId?: string
  lastHeartbeat?: Date
}

export interface McpConfig {
  name: string
  connectionString: string
  serverConfig: Record<string, unknown>
  status: McpStatus
  validationLog?: string
  toolsFound?: string[]
  registeredAt: Date
  validatedAt?: Date
}

export interface FeedbackEvent {
  id: string
  source: 'ui' | 'telegram' | 'slack' | 'webhook'
  text: string
  status: FeedbackStatus
  prUrl?: string
  prDiff?: string
  createdAt: Date
}
