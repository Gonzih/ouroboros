# Spec: packages/meta-agent

## Purpose
The always-on coordinator. Three concurrent loops driven by Redis. Singleton — only one instance runs at a time (instance lock pattern).

## Startup Sequence
1. Acquire `ouro:instance:lock` (NX, TTL 1800s) — exit if already held
2. Start heartbeat (refresh TTL every 60s)
3. Crash recovery: check `ouro:current_task`, log and clear if found
4. Start three event loops concurrently

## Loop 1 — Self-Evolution (Ouroboros Loop)

```
poll ouro:feedback (lpop, 5s interval)
  → deserialize FeedbackEvent
  → build evolution prompt
  → spawnSync claude --print --dangerously-skip-permissions -p "{prompt}"
      cwd = repo root (so project-scoped MCPs are available)
      env includes CLAUDE_CODE_OAUTH_TOKEN
  → check output for EVOLUTION_DONE marker
  → publish completion to ouro:notify
  → log result
```

**Evolution prompt template:**
```
You are operating on the Ouroboros codebase at {repoRoot}.
A user submitted this feedback: "{feedbackText}"

Implement this as a code change:
1. Create a branch feat/feedback-{id}
2. Make the change
3. Run pnpm build to verify it compiles
4. Open a PR and merge it

When done, respond with exactly: EVOLUTION_DONE
```

**Open questions:**
- [ ] Should feedback trigger a PR review step before merge, or always auto-merge?
- [ ] Rate limit: max 1 evolution per N minutes to avoid runaway self-modification?
- [ ] Should failed evolutions be retried or dead-lettered?

## Loop 2 — Worker Dispatch

```
poll ouro:tasks (lpop, 2s interval)
  → deserialize task: { id, backend, target, instructions }
  → set ouro:jobs:{id} status=running
  → spawn worker subprocess: node packages/worker/dist/index.js
      env: OURO_TASK=<json>
  → stream output to ouro:jobs:{id}:output
  → on exit: update status, publish to ouro:notify
```

**Open questions:**
- [ ] Worker as subprocess vs spawning a new cc-agent job? Subprocess is simpler, cc-agent gives isolation.
- [ ] Max concurrent workers? (suggested: 3)
- [ ] Timeout per worker? (suggested: 30 min)

## Loop 3 — MCP Registry Watch

```
poll ouro:mcp:registry changes (every 30s, compare known keys vs current)
  → for each new key: deserialize McpConfig
  → patch ~/.claude.json: add to projects.{repoRoot}.mcpServers
  → publish notification: "MCP {name} registered"
```

**Open questions:**
- [ ] Should MCP registration require restart of meta-agent, or hot-reload?
- [ ] Conflict handling: what if an MCP name already exists in claude.json?

## Instance Lock
Same pattern as white-hat-scanner:
```typescript
const lock = await redis.set('ouro:instance:lock', pid, 'EX', 1800, 'NX')
if (!lock) process.exit(0)
setInterval(() => redis.expire('ouro:instance:lock', 1800), 60_000)
```
