# Spec: packages/core

## Purpose
Shared foundation imported by all other packages. Zero side effects on import.

## Exports

### Types
```typescript
type JobStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'

type StorageBackend = 'git' | 'local' | 's3' | 'gdrive'

interface Job {
  id: string
  taskDescription: string
  backend: StorageBackend
  target: string          // repo URL, folder path, S3 prefix, Drive folder ID
  status: JobStatus
  createdAt: number
  startedAt?: number
  completedAt?: number
  output?: string
  error?: string
}

interface McpConfig {
  name: string
  connectionString: string
  serverConfig: Record<string, unknown>  // claude.json mcpServers entry
  registeredAt: number
}

interface FeedbackEvent {
  id: string
  source: 'telegram' | 'ui'
  text: string
  createdAt: number
}

interface LogEntry {
  ts: number
  source: string
  message: string
}
```

### Redis
```typescript
getRedis(): Redis   // singleton ioredis client, reads REDIS_URL env
```

### Logger
```typescript
log(source: string, message: string): Promise<void>
// Writes to ouro:logs (ltrim to 2000) and stdout
```

### Event Bus
```typescript
publish(channel: string, payload: unknown): Promise<void>
subscribe(channel: string, cb: (payload: unknown) => void): Promise<void>
```

## Open Questions
- [ ] Should LogEntry be typed or free-form string?
- [ ] Do we need a job store helper in core, or keep Redis access raw in each package?
- [ ] Error serialization format for failed jobs?
