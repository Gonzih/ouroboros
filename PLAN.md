# PLAN: packages/worker — Full Implementation

## Task Restatement
Implement a stateless task executor in `packages/worker`. It reads a task from the `OURO_TASK` env var, spawns a claude subprocess against a storage backend (git, local, or stubbed s3/gdrive/onedrive), streams output line-by-line to Postgres (`ouro_job_output`), commits changes on success, and exits.

## Approaches Considered

### A: Monolithic run.ts (no abstraction layers)
All backend logic and runner logic in one file. Simple, but not extensible and hard to test.

### B: Backend interface + separate files per backend + thin run.ts (chosen)
Interface in `backends/interface.ts`, each backend in its own file, `run.ts` just orchestrates. Clean, testable, matches spec exactly.

### C: Backend factory with dynamic import
Lazy-load backend modules. Over-engineered for this v1 — just use a switch statement.

## Chosen Approach: B
Matches the spec and existing project style (plain functions and interfaces, no classes). Each backend file is independently testable.

## Files to Touch
- `packages/worker/src/backends/interface.ts` (create)
- `packages/worker/src/backends/git.ts` (create)
- `packages/worker/src/backends/local.ts` (create)
- `packages/worker/src/backends/s3.ts` (create)
- `packages/worker/src/backends/gdrive.ts` (create)
- `packages/worker/src/backends/onedrive.ts` (create)
- `packages/worker/src/run.ts` (create)
- `packages/worker/src/index.ts` (overwrite skeleton)
- `packages/worker/src/test/backends.test.ts` (create)

## Key Design Decisions
- Use `spawnSync` for git/gh commands (synchronous is fine, they are short-lived)
- Use `spawn` + readline for claude (async streaming of output)
- Idle detection: track `lastOutputAt`, check every 60s, warn if > 600s
- Output goes to `ouro_job_output` table (Postgres only — no Redis per CLAUDE.md)
- `NOTIFY 'ouro_notify'` on job completion
- `cleanup()` always runs in a finally block
- TaskInput `backend` field is a string name, select via switch

## Risks & Unknowns
- `gh` CLI must be installed and authenticated for GitBackend
- `spawnSync` on git clone can hang on auth prompt — set timeout option
- The `ouro_job_output` table may not exist if migrate() hasn't run — we call migrate() first in start()
- Cross-platform path separators: use `path.join` everywhere
- noUncheckedIndexedAccess from tsconfig.base.json — must guard all array accesses
