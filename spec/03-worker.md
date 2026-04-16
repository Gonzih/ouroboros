# Spec: packages/worker

## Purpose
Executes a single task against a storage backend. Spawned by meta-agent per task. Stateless — reads task from env, reports to Redis, exits.

## Interface

Receives task via environment:
```
OURO_TASK = JSON string of:
{
  id: string
  backend: StorageBackend
  target: string
  instructions: string
}
```

## Backend Implementations

### git
- Clone `target` (GitHub URL)
- Create branch `feat/task-{id}`
- Spawn `claude --print --dangerously-skip-permissions -p "{instructions}\n\nEnd with: TASK_DONE"`
- Verify TASK_DONE marker
- Open PR, merge

### local
- `target` = absolute folder path
- No clone — operate directly on disk
- Run claude subprocess with cwd=target
- If folder has a git repo: commit changes with message from task id
- No PR step — local changes committed directly

### s3 (stub v1)
- Log "s3 backend not yet implemented"
- Mark job failed with reason

### gdrive (stub v1)
- Log "gdrive backend not yet implemented"  
- Mark job failed with reason

## Progress Reporting

```typescript
// On start:
await redis.hset(`ouro:jobs:${id}`, { status: 'running', startedAt: Date.now() })

// Streaming output (append to list):
await redis.rpush(`ouro:jobs:${id}:output`, line)
await redis.ltrim(`ouro:jobs:${id}:output`, -500, -1)  // keep last 500 lines

// On complete:
await redis.hset(`ouro:jobs:${id}`, { status: 'completed', completedAt: Date.now() })
await redis.publish('ouro:notify', JSON.stringify({ type: 'job_complete', jobId: id }))

// On fail:
await redis.hset(`ouro:jobs:${id}`, { status: 'failed', error: message, completedAt: Date.now() })
```

## Open Questions
- [ ] Should worker stream output lines in real-time or batch at end?
- [ ] What's the right timeout? claude can run for 10+ minutes on complex tasks
- [ ] For git backend: should worker use cc-agent API or spawn its own claude directly?
- [ ] For local backend: should we always git-init if no .git found?
