# Spec: packages/worker

## Purpose
Executes a single task against a storage backend. Stateless — reads task from env or Redis, reports progress in real-time, exits when done. Spawned as a subprocess by meta-agent.

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

## Claude Subprocess

Worker spawns claude with the task instructions and streams output in real-time:

```typescript
const proc = spawn('claude', ['--print', '--dangerously-skip-permissions', '-p', prompt], {
  cwd: workdir,
  env: { ...process.env, CLAUDE_CODE_OAUTH_TOKEN: token },
})

proc.stdout.on('data', async (chunk) => {
  const line = chunk.toString()
  process.stdout.write(line)
  await redis.rpush(`ouro:jobs:${taskId}:output`, line)
  await redis.ltrim(`ouro:jobs:${taskId}:output`, -500, -1)
})
```

No timeout — the task runs until claude exits. Progress is visible in real-time via UI and gateway notifications. If nothing is happening for > 10 minutes, log a heartbeat warning but don't kill the process.

## Progress Reporting

```typescript
// On start
await redis.hset(`ouro:jobs:${id}`, 'status', 'running', 'startedAt', Date.now())

// Live output — streamed line by line to Redis list + WebSocket

// On complete
await redis.hset(`ouro:jobs:${id}`, 'status', 'completed', 'completedAt', Date.now())
await redis.publish('ouro:notify', JSON.stringify({
  type: 'job_complete', jobId: id, status: 'completed'
}))

// On fail
await redis.hset(`ouro:jobs:${id}`, 'status', 'failed', 'error', message, 'completedAt', Date.now())
await redis.publish('ouro:notify', JSON.stringify({
  type: 'job_complete', jobId: id, status: 'failed'
}))
```

## Open Questions (resolved)
- ✅ Worker isolation: subprocess (not cc-agent) — simpler, sufficient for v1
- ✅ Local backend git: auto git-init if no .git found
- ✅ Timeout: no hard timeout — show live progress, warn after 10min idle
- ⬜ S3/GDrive/OneDrive: stubbed for v1, implement via Ouroboros feedback loop when needed
