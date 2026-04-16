# Spec: packages/core

## Purpose
Shared foundation. Imported by all packages. Zero side effects on import. All Postgres interaction goes through here.

## Dependencies
- `postgres` (sql template literal library — simpler than pg, works great with TypeScript)
- No ORM

## Database Setup

Core exports a `migrate()` function that runs on startup of any package that needs the DB. Migrations are plain SQL files in `packages/core/migrations/`.

### Schema

```sql
-- 001_init.sql

-- Enable pgmq for queues
CREATE EXTENSION IF NOT EXISTS pgmq;

-- Queues (created once, idempotent)
SELECT pgmq.create('ouro_tasks');
SELECT pgmq.create('ouro_feedback');

-- Job state
CREATE TABLE IF NOT EXISTS ouro_jobs (
  id          TEXT PRIMARY KEY,
  description TEXT NOT NULL,
  backend     TEXT NOT NULL,        -- 'git' | 'local' | 's3' | 'gdrive' | 'onedrive'
  target      TEXT NOT NULL,        -- repo URL, folder path, bucket prefix, etc.
  status      TEXT NOT NULL DEFAULT 'pending',  -- pending|running|completed|failed|cancelled
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at  TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  error       TEXT,
  output      TEXT                  -- final output summary (full output in ouro_job_output)
);

CREATE TABLE IF NOT EXISTS ouro_job_output (
  job_id      TEXT NOT NULL REFERENCES ouro_jobs(id),
  line        TEXT NOT NULL,
  ts          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_job_output_job_id ON ouro_job_output(job_id);

-- MCP registry
CREATE TABLE IF NOT EXISTS ouro_mcp_registry (
  name              TEXT PRIMARY KEY,
  connection_string TEXT NOT NULL,
  server_config     JSONB NOT NULL,   -- the mcpServers entry for ~/.claude.json
  status            TEXT NOT NULL DEFAULT 'pending',  -- pending|operational|partial|failed
  validation_log    TEXT,
  tools_found       TEXT[],
  registered_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  validated_at      TIMESTAMPTZ
);

-- Feedback / evolution history
CREATE TABLE IF NOT EXISTS ouro_feedback (
  id          TEXT PRIMARY KEY,
  source      TEXT NOT NULL,          -- 'ui' | 'telegram' | 'slack' | 'webhook'
  text        TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'pending',  -- pending|pr_open|approved|rejected|applied
  pr_url      TEXT,
  pr_diff     TEXT,
  rejection_reason TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ
);

-- Logs (partitioned by day for size management)
CREATE TABLE IF NOT EXISTS ouro_logs (
  id          BIGSERIAL,
  source      TEXT NOT NULL,
  message     TEXT NOT NULL,
  ts          TIMESTAMPTZ NOT NULL DEFAULT NOW()
) PARTITION BY RANGE (ts);

-- Auto-create today's partition on first insert (handled by migrate())
```

## Postgres Client

```typescript
// getDb() — singleton connection, reads DATABASE_URL
import postgres from 'postgres'

let _db: postgres.Sql | null = null

export function getDb(): postgres.Sql {
  if (!_db) _db = postgres(process.env.DATABASE_URL!)
  return _db
}
```

## Logger

```typescript
export async function log(source: string, message: string): Promise<void>
// Inserts into ouro_logs
// Also writes to stdout: [source] message
// Never throws — log failures are swallowed
```

## Event Bus (LISTEN/NOTIFY)

```typescript
export async function publish(channel: string, payload: unknown): Promise<void>
// NOTIFY channel, JSON.stringify(payload)

export async function subscribe(
  channel: string,
  cb: (payload: unknown) => void
): Promise<() => void>  // returns unsubscribe function
// Opens dedicated connection (LISTEN requires a dedicated connection)
// Calls cb with parsed JSON on each notification
// Reconnects automatically on disconnect
```

## Queue Helpers (pgmq wrappers)

```typescript
export async function enqueue(queue: string, message: unknown): Promise<bigint>
// pgmq.send — returns message id

export async function dequeue<T>(queue: string, visibilityTimeout?: number): Promise<{
  id: bigint
  message: T
} | null>
// pgmq.read with default visibility timeout 60s
// Returns null if queue is empty

export async function ack(queue: string, msgId: bigint): Promise<void>
// pgmq.delete — call after successful processing

export async function nack(queue: string, msgId: bigint): Promise<void>
// pgmq.set_vt with 0 — makes message immediately visible again (requeue)
```

## Shared Types

```typescript
export type JobStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'
export type StorageBackend = 'git' | 'local' | 's3' | 'gdrive' | 'onedrive'
export type McpStatus = 'pending' | 'operational' | 'partial' | 'failed'
export type FeedbackStatus = 'pending' | 'pr_open' | 'approved' | 'rejected' | 'applied'

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
```

## Advisory Lock Helpers

```typescript
export async function tryAcquireLock(key: string): Promise<boolean>
// SELECT pg_try_advisory_lock(hashtext(key))

export async function releaseLock(key: string): Promise<void>
// SELECT pg_advisory_unlock(hashtext(key))
// Lock auto-releases on connection close (process crash = lock gone)
```
