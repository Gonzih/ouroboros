# Spec: packages/mcp-server (v0.2 roadmap)

## Status: Implemented (v0.2.0)

This package closes the Ouroboros cycling loop. It exposes Ouroboros internals as MCP tools so Claude can control the system directly, replacing the Node.js polling coordinator.

Implemented tools (18 total):
- **Jobs**: `list_jobs`, `get_job_output`, `get_job_status`, `spawn_worker`, `cancel_job`
- **MCP**: `list_mcps`, `register_mcp`, `delete_mcp`, `test_mcp`
- **Feedback**: `submit_feedback`, `list_feedback`, `approve_evolution`, `reject_evolution`
- **Logs**: `get_logs`
- **Schedules**: `list_schedules`, `create_schedule`, `toggle_schedule`, `delete_schedule`

Entry point: `packages/mcp-server/dist/index.js` (stdio MCP transport).
Mounted via `claude-control.json` in the coordinator session.

---

## The Problem It Solves

In v0.1.0, the meta-agent is a Node.js process with polling loops:
- Loop 2 polls pgmq every 2 seconds to dispatch workers
- Loop 3 polls pgmq every 5 seconds to run evolution
- Loop 4 polls Postgres every 60 seconds for dead workers
- Workers are spawned via `spawnSync('claude', [...])` — one-shot, stateless

This works. But it means intelligence (Claude) and control (Node.js) are separate. Claude is a tool called by the coordinator, not the coordinator itself.

**v0.2 target**: Claude IS the coordinator. The Node.js loops become MCP tools Claude calls.

---

## The Cycling Loop

```
Ouroboros infrastructure
  (Postgres + pgmq, mcp-factory, worker processes, gateway, ui)
         │
         │ spawns and manages
         ▼
  Claude Code (persistent --continue session)
         │
         │ uses two categories of MCP:
         │
         ├─── @ouroboros/mcp-server (Control MCP)
         │      Ouroboros' own internals exposed as tools
         │      list_jobs()        → query ouro_jobs
         │      spawn_worker()     → enqueue to ouro_tasks
         │      get_job_output()   → query ouro_job_output
         │      cancel_job()       → UPDATE ouro_jobs SET status='cancelled'
         │      list_mcps()        → query ouro_mcp_registry
         │      register_mcp()     → POST /mcp/register on mcp-factory
         │      submit_feedback()  → enqueue to ouro_feedback
         │      approve_evolution()→ UPDATE ouro_feedback SET status='approved'
         │      reject_evolution() → UPDATE ouro_feedback SET status='rejected'
         │      get_logs()         → query ouro_logs
         │
         └─── Customer Data MCPs (provisioned by mcp-factory)
                postgres://user:pass@host/mydb
                file:///data/reports
                github://acme/internal-wiki
                sqlite:///app.db
                → Claude queries customer data directly
                → data never leaves the machine
         │
         │ reasons over customer data
         │ acts via control MCP
         │ sees results
         │ reasons again
         ▼
  (loop repeats — snake eats its tail)
```

Ouroboros spawns Claude. Claude controls Ouroboros via the Control MCP. Ouroboros provisioned the Customer Data MCPs that Claude uses to reason. One closed loop with no external coordinator.

---

## Package Definition

```
packages/mcp-server/
  src/
    index.ts          — MCP server entry point, tool registration
    tools/
      jobs.ts         — list_jobs, get_job_output, spawn_worker, cancel_job
      mcp.ts          — list_mcps, register_mcp
      feedback.ts     — submit_feedback, approve_evolution, reject_evolution
      logs.ts         — get_logs
    db.ts             — shared Postgres client (re-uses @ouroboros/core)
  package.json
  tsconfig.json
```

Uses the MCP TypeScript SDK (`@modelcontextprotocol/sdk`) to register tools and serve over stdio or SSE.

---

## Tool Definitions

### Job Management

```typescript
list_jobs({ status?: JobStatus, limit?: number }) → Job[]
// SELECT * FROM ouro_jobs WHERE status=$1 ORDER BY created_at DESC LIMIT $2
// Omit status to list all. Default limit 20.

get_job_output({ jobId: string, tail?: number }) → string[]
// SELECT line FROM ouro_job_output WHERE job_id=$1 ORDER BY ts DESC LIMIT $2
// Default tail 100 lines.

spawn_worker({ description: string, backend: StorageBackend, target: string }) → Job
// INSERT INTO ouro_jobs (...) RETURNING *
// enqueue({ queue: 'ouro_tasks', message: { id, backend, target, instructions: description } })
// Returns the created Job.

cancel_job({ jobId: string }) → void
// UPDATE ouro_jobs SET status='cancelled' WHERE id=$1 AND status IN ('pending','running')
// If running: NOTIFY worker process via pg_cancel_backend or job status check
```

### MCP Management

```typescript
list_mcps() → McpConfig[]
// SELECT * FROM ouro_mcp_registry ORDER BY registered_at DESC

register_mcp({ name: string, connectionString: string }) → McpConfig
// POST /mcp/register on mcp-factory (port 7703)
// mcp-factory handles validation + claude.json patching
// Returns McpConfig with validation status
```

### Feedback / Evolution

```typescript
submit_feedback({ text: string, source: string }) → FeedbackEvent
// INSERT INTO ouro_feedback (...) RETURNING *
// enqueue({ queue: 'ouro_feedback', message: { id, source, text, status: 'pending' } })

approve_evolution({ id: string }) → void
// UPDATE ouro_feedback SET status='approved' WHERE id=$1

reject_evolution({ id: string, reason?: string }) → void
// UPDATE ouro_feedback SET status='rejected', rejection_reason=$2 WHERE id=$1
```

### Logs

```typescript
get_logs({ source?: string, limit?: number, since?: string }) → LogEntry[]
// SELECT * FROM ouro_logs WHERE source=$1 AND ts > $2 ORDER BY ts DESC LIMIT $3
// source: 'meta-agent' | 'worker' | 'gateway' | 'mcp-factory' | 'ui' | undefined (all)
// since: ISO timestamp string
// Default limit 50 lines.
```

---

## v0.2 Meta-Agent Entry Point

When `@ouroboros/mcp-server` exists, the meta-agent bootstrap changes from:

```typescript
// v0.1.0 — Node.js polling coordinator
await Promise.all([
  startMcpWatch(),
  startWorkerDispatch(),
  startEvolution(),
  watchdogLoop(state),
])
```

To:

```bash
# v0.2 — Claude as coordinator
claude --continue \
  --mcp-config ouroboros-control.json \
  --dangerously-skip-permissions
```

Where `ouroboros-control.json` contains:
```json
{
  "mcpServers": {
    "ouroboros": {
      "command": "node",
      "args": ["packages/mcp-server/dist/index.js"]
    }
  }
}
```

The Node.js polling loops in v0.1.0 are replaced by Claude reasoning over tool calls. The initial prompt given to this persistent session explains the coordinator role:

```
You are the Ouroboros coordinator. Your job is to:
1. Monitor and dispatch worker tasks from the ouro_tasks queue
2. Process user feedback and open evolution PRs
3. Monitor job health and requeue stale workers
4. Notify users of completions and evolution proposals

Use your MCP tools to observe and act. You have access to both Ouroboros
control tools and the customer data MCPs registered in the system.
```

---

## Migration Path (v0.1 → v0.2)

The v0.1 Node.js code does not go away — it becomes the **bootstrap** that starts the v0.2 Claude session. The polling loops are replaced, but:

- `packages/core` is unchanged (Postgres client, types, events)
- `packages/mcp-factory` is unchanged (HTTP API on 7703)
- `packages/gateway` is unchanged (multi-channel notifications)
- `packages/ui` is unchanged (Vue 3 web interface)
- `packages/worker` is unchanged (task execution subprocess)
- `packages/meta-agent` is simplified: instead of 4 loops, it just starts the Claude session

The data model (ouro_jobs, ouro_mcp_registry, ouro_feedback, ouro_logs) is unchanged. The MCP tools are thin wrappers over the same Postgres queries the Node.js loops run today.

---

## Why This is Worth Building

The cycling loop is not just an architectural curiosity. It changes what the system can do:

1. **Long-horizon reasoning**: A persistent Claude session accumulates context across all interactions. It can notice patterns across many jobs, notice that a particular MCP is repeatedly failing, and proactively submit feedback to fix it.

2. **Self-diagnosis**: Claude can call `get_logs()`, see an error, reason about the cause, and submit a `submit_feedback()` to fix it — without a human in the loop. Human approval is still required for the code change (Loop 3), but the diagnosis and proposal happen automatically.

3. **Natural language control surface**: Instead of the UI and gateway being the only control surfaces, any MCP client can connect to `@ouroboros/mcp-server` and manage the system via tool calls. Including Claude itself.

4. **No coordination code**: The meta-agent coordinator logic lives in Claude's reasoning, not in bespoke Node.js polling code. New behaviors (e.g., "check on long-running jobs every hour") are added by updating the coordinator prompt, not by writing new polling loops.
