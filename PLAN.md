# PLAN: Ouroboros Monorepo Bootstrap

## Task Restatement
Create the complete pnpm monorepo scaffold for Ouroboros — a self-hosted AI data infrastructure connecting private data sources to Claude Code via MCP servers. No implementation logic yet; just the skeleton every other agent will build on.

## Approach
Single approach: standard pnpm workspace monorepo with TypeScript project references.

- Root `pnpm-workspace.yaml` lists all packages
- Root `package.json` as private workspace with top-level scripts
- Shared `tsconfig.base.json` with strict settings
- Per-package `package.json` + `tsconfig.json` + `src/index.ts` stubs
- `packages/core` additionally exports shared types from spec
- `docker-compose.yml` for Postgres 16 + pgmq
- Cross-platform install scripts (macOS/Linux/Windows)

## Files to Touch
- `/PLAN.md` (this file)
- `/TODO.md`
- `/pnpm-workspace.yaml`
- `/package.json`
- `/tsconfig.base.json`
- `/.env.example`
- `/docker-compose.yml`
- `/.gitignore` (extend existing)
- `/scripts/install.sh`
- `/scripts/install.ps1`
- `/scripts/setup-db.sh`
- `/packages/core/package.json`, `tsconfig.json`, `src/index.ts`, `src/types.ts`
- `/packages/meta-agent/package.json`, `tsconfig.json`, `src/index.ts`
- `/packages/worker/package.json`, `tsconfig.json`, `src/index.ts`
- `/packages/ui/package.json`, `tsconfig.json`, `src/index.ts`
- `/packages/gateway/package.json`, `tsconfig.json`, `src/index.ts`
- `/packages/mcp-factory/package.json`, `tsconfig.json`, `src/index.ts`

## Risks
- pgmq Docker init: must run `CREATE EXTENSION IF NOT EXISTS pgmq` after DB is ready
- pnpm version compatibility: use pnpm 9.x
- Windows install script needs Task Scheduler XML format
