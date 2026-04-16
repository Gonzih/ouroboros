# PLAN — Vitest Unit Tests Across All Packages

## Goal
Add Vitest unit tests to all 6 packages. All packages use ESM with Node16 module resolution and TypeScript strict mode.

## Approach
- Add vitest + @vitest/coverage-v8 to root devDependencies
- Each package gets vitest.config.ts and updated test script
- Use vi.mock() for all external dependencies

## Package-by-package

### core: queue.ts, locks.ts, types.ts
### mcp-factory: parse.ts, generate.ts, claude-json.ts, validate.ts
### worker: backends/git.ts, backends/local.ts
### meta-agent: claude.ts, loops/evolution.ts (regex/shape tests); exclude src/test/ node:test files
### gateway: all adapters + gateway.ts
### ui: extract app.ts from index.ts; test REST routes via supertest

---

# PLAN: Dev Infra — docker-compose, install scripts, Quick Start README

## Task Summary
Add/update dev infrastructure for the Ouroboros monorepo: docker-compose.yml with pgvector/pgmq-capable Postgres, .env.example with all vars, macOS/Linux/Windows install scripts that check prereqs + build + register supervisor, and a Quick Start section in README.md.

## What already exists (discovered by reading)
- `docker-compose.yml`: uses `postgres:16-alpine`, mounts `scripts/init-db.sql`
- `.env.example`: complete except missing `OURO_MAX_WORKERS=3`
- `scripts/install.sh`: service installer only (requires .env already present, no prereq checks, no build step)
- `scripts/install.ps1`: good Windows installer, same gap (requires .env, no prereq checks, no build step)
- `README.md`: no Quick Start section

## Approach
Minimal targeted edits — no rewrites. Add the missing pieces to each file:
1. docker-compose.yml: change image, rename volume
2. .env.example: add OURO_MAX_WORKERS line
3. install.sh: add prereq checks at top, change error-on-missing-.env to copy-from-.env.example, add pnpm install/build steps
4. install.ps1: same additions for Windows
5. README.md: append Quick Start section before EOF

## Files to touch
- `docker-compose.yml`
- `.env.example`
- `scripts/install.sh`
- `scripts/install.ps1`
- `README.md`

## Risks
- pgvector/pgvector:pg16 may not ship pgmq — init-db.sql CREATE EXTENSION will fail silently or error; acceptable for dev infra (user is warned in docs)
- install.sh changes must not break existing service-registration logic
