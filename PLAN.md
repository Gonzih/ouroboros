# Plan: meta-agent v2 — persistent Claude coordinator session

## Task Restatement
Upgrade meta-agent from four Node.js polling loops to a thin supervisor that spawns a persistent Claude session as the actual coordinator. Claude uses the Ouroboros MCP tools (`@ouroboros/mcp-server`) to reason and act. Keep v0.1 loops as `OURO_LEGACY_LOOPS=true` fallback. Watchdog + advisory lock stay in Node.js (must outlive Claude sessions).

## Architecture Shift
```
v0.1 (before):
meta-agent Node.js
  Loop 1: LISTEN/NOTIFY → log MCP registrations
  Loop 2: poll pgmq every 2s → spawn workers
  Loop 3: poll pgmq every 5s → spawnSync claude for evolution
  Loop 4: watchdog every 60s → fix dead PIDs

v0.2 (after):
meta-agent Node.js (thin supervisor)
  - migrate() + advisory lock + crash recovery + signal handlers (unchanged)
  - watchdogLoop() stays in Node.js (Claude can't watch its own PID)
  - spawnCoordinator() → persistent Claude session with --mcp-config claude-control.json
  - runCoordinatorLoop() → restart Claude on exit with 5s backoff
  - OURO_LEGACY_LOOPS=true → fallback to v0.1 loops unchanged
```

## Approaches Considered

### A) Full replacement — delete polling loops
- Pro: minimal code
- Con: no rollback path if Claude coordinator breaks in production

### B) Parallel coexistence — run both simultaneously
- Pro: belt-and-suspenders
- Con: double-processes everything, conflicting state writes

### C) Feature-flag switch (chosen)
`OURO_LEGACY_LOOPS=true` switches back to v0.1. Default is v0.2.
- Pro: explicit rollback, operators can cut over when ready
- Con: two code paths to maintain

## Session ID Handling
`.ouro-session` file in repo root (gitignored):
- Not present → fresh start: `claude --print -p {coordinator_prompt}`
- Present → resume: `claude --continue --print -p "Continue coordination..."`
- Both cases use `--print` to ensure non-interactive subprocess behavior
- On first start: write 'started' to file immediately after spawn
- If real UUID is parsed from Claude output: overwrite 'started' with UUID

## Files to Touch
- `packages/meta-agent/src/coordinator.ts` — NEW
- `packages/meta-agent/src/index.ts` — add runCoordinatorLoop(), OURO_LEGACY_LOOPS branch
- `packages/meta-agent/src/__tests__/coordinator.test.ts` — NEW
- `.gitignore` — add .ouro-session, logs/, *.err
- `.env.example` — add OURO_LEGACY_LOOPS

## Risks & Unknowns
- `noUncheckedIndexedAccess: true` — regex `match?.[1]` returns `string | undefined`, guard before use
- `--continue` requires same cwd as original session — guaranteed via `cwd: repoRoot`
- Claude output session ID parsing is best-effort; placeholder 'started' handles the case where no UUID appears
