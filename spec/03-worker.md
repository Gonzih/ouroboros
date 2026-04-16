# Spec: packages/worker

## Purpose
Executes a single task against a storage backend. Stateless — reads task from `OURO_TASK` env var, reports progress to Postgres in real-time, exits when done. Spawned as a subprocess by meta-agent.

## Storage Backend Abstraction

```typescript
interface StorageBackend {
  name: string
  // Prepare the working directory (clone, mount, sync, etc.)
  prepare(target: string, taskId: string): Promise<string>  // returns local workdir path
  // Commit/push/sync changes after task completes
  commit(workdir: string, message: string): Promise<void>
  // Clean up (delete clone, unmount, etc.)
  cleanup(workdir: string): Promise<void>
}
```

Worker calls: `prepare → run claude → commit → cleanup`. Backend is a plugin — adding a new storage type means implementing this interface.

## Backend Implementations

### GitBackend
- `prepare`: `git clone target /tmp/ouro-{taskId}`, create branch `feat/task-{taskId}`
- `commit`: `git add -A && git commit -m "task: {taskId}"`, push branch, open PR via `gh pr create`, merge with `gh pr merge --squash --auto`
- `cleanup`: `rm -rf /tmp/ouro-{taskId}`
- Required env: `GITHUB_TOKEN`

### LocalBackend
- `prepare`: resolves `target` as absolute path, verifies it exists. If no `.git`: runs `git init && git add -A && git commit -m "init"` automatically.
- `commit`: `git add -A && git commit -m "ouro task {taskId}: {first 60 chars of instructions}"`
- `cleanup`: no-op (it's the user's own folder)
- No PR step — changes are committed locally

### S3Backend (stub v1)
- `prepare`: `aws s3 sync s3://{bucket}/{prefix} /tmp/ouro-{taskId}`
- `commit`: `aws s3 sync /tmp/ouro-{taskId} s3://{bucket}/{prefix}`
- `cleanup`: `rm -rf /tmp/ouro-{taskId}`
- Required env: `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`
- v1: basic sync, no versioning

### GDriveBackend (stub v1)
- Uses `rclone` — must be installed and configured
- `prepare`: `rclone copy gdrive:{folderId} /tmp/ouro-{taskId}`
- `commit`: `rclone copy /tmp/ouro-{taskId} gdrive:{folderId}`
- `cleanup`: `rm -rf /tmp/ouro-{taskId}`
- v1: full sync (no incremental)

### OneDriveBackend (stub v1)
- Also uses `rclone` with OneDrive remote
- Same pattern as GDriveBackend

## Session Continuity (--continue)

Workers register their PID on startup and emit heartbeats every 30 seconds. The watchdog loop in meta-agent detects dead/stale workers and requeues them — passing `session_id` so the resumed worker can pick up where Claude left off.

### On startup

```typescript
await registerProcess(`worker:${jobId}`, process.pid, 'node', [])
const existingSessionId = task.sessionId  // from requeued message, or undefined
const newSessionId = randomUUID()
await setJobSession(jobId, process.pid, existingSessionId ?? newSessionId)
```

### Heartbeat every 30 seconds

```typescript
const heartbeatInterval = setInterval(() => {
  void setJobHeartbeat(jobId)
  void heartbeat(`worker:${jobId}`)
}, 30_000)
// cleared in finally block
```

### Claude invocation

```typescript
const claudeArgs = existingSessionId !== undefined
  ? ['--continue', '--dangerously-skip-permissions']
  : ['--print', '--dangerously-skip-permissions', '-p', prompt]
```

`--continue` resumes the last Claude session from the same working directory (`target`). The watchdog preserves `job.target` in the requeued message so the resumed worker uses the same `cwd`.

## Claude Subprocess

Worker spawns claude with the task instructions and streams output in real-time:

```typescript
const proc = spawn('claude', claudeArgs, {
  cwd: workdir,
  env: { ...process.env, CLAUDE_CODE_OAUTH_TOKEN: token },
})

proc.stdout.on('data', async (chunk) => {
  const line = chunk.toString()
  process.stdout.write(line)
  await db`INSERT INTO ouro_job_output (job_id, line) VALUES (${jobId}, ${line})`
})
```

No timeout — the task runs until claude exits. Progress is visible in real-time via UI and gateway notifications. If nothing is happening for > 10 minutes, the heartbeat goes stale and the watchdog will requeue the job with its session_id so it can be resumed.

## Progress Reporting (Postgres)

```typescript
// On start
await db`UPDATE ouro_jobs SET status='running', started_at=NOW(), pid=${process.pid} WHERE id=${id}`

// Live output — streamed line by line to ouro_job_output + published via NOTIFY

// On complete
await db`UPDATE ouro_jobs SET status='completed', completed_at=NOW() WHERE id=${id}`
await publish('ouro_notify', { type: 'job_complete', jobId: id, status: 'completed' })

// On fail
await db`UPDATE ouro_jobs SET status='failed', error=${message}, completed_at=NOW() WHERE id=${id}`
await publish('ouro_notify', { type: 'job_complete', jobId: id, status: 'failed' })
```

## Open Questions (resolved)
- ✅ Worker isolation: subprocess (not cc-agent) — simpler, sufficient for v1
- ✅ Local backend git: auto git-init if no .git found
- ✅ Timeout: no hard timeout — heartbeat goes stale after 10min idle, watchdog requeues with session_id
- ✅ Session continuity: --continue on resume, session_id persisted in ouro_jobs
- ⬜ S3/GDrive/OneDrive: stubbed for v1, implement via Ouroboros feedback loop when needed
