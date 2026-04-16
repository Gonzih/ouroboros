# Plan: Spec v2 — Cycling Loop Architecture

## Task Restatement

Rewrite the Ouroboros spec to accurately reflect what was actually built AND articulate the intended v0.2 architectural evolution (the true "Ouroboros cycling loop"). The spec must document as-built code (v0.1.0), not aspirational pseudocode. New and updated files must clearly mark what's implemented vs. roadmap.

## Key Findings from Reading the Codebase

**Already built (v0.1.0):**
- meta-agent: 4 loops running (`startMcpWatch`, `startWorkerDispatch`, `startEvolution`, `watchdogLoop`)
- core: process-registry exports (registerProcess, unregisterProcess, heartbeat, setJobSession, setJobHeartbeat, getStaleJobs)
- spec/08-self-healing.md already exists — accurate
- worker: subprocess pattern with `--continue` for resume
- gateway: multi-adapter (Telegram, Slack, webhook, log-always)

**Stale in existing specs:**
- spec/03-worker.md and spec/05-gateway.md reference Redis (wrong — Postgres/pgmq only)
- spec/02-meta-agent.md only documents 3 loops (missing Loop 4 watchdog)
- spec/07-open-questions.md doesn't address "persistent session" decision
- README.md is missing Architecture diagram and Roadmap section
- spec/09-mcp-server.md doesn't exist yet

## Approach

Direct spec updates — no code changes. Update markdown files to match what's built, add v0.2 architectural vision.

## Files to Touch

| File | Action |
|---|---|
| `spec/00-overview.md` | Add Loop 4, cycling loop concept, convergence table |
| `spec/02-meta-agent.md` | Add Loop 4 watchdog, --continue note, v0.2 vision |
| `spec/03-worker.md` | Fix Redis refs → Postgres; add heartbeat, session_id, --continue |
| `spec/05-gateway.md` | Fix Redis refs → Postgres/LISTEN-NOTIFY |
| `spec/07-open-questions.md` | Add persistent session decision, cycling loop decision |
| `spec/08-self-healing.md` | Already exists + accurate — minor tweaks only if needed |
| `spec/09-mcp-server.md` | NEW: @ouroboros/mcp-server v0.2, tool list, cycling loop |
| `README.md` | Add Architecture section (cycling loop diagram), Roadmap section |

## Risks

- spec/08-self-healing.md already exists and is accurate — verify before touching
- spec/03-worker.md has deep Redis references that need full replacement
- README.md cycling loop ASCII art must be clear enough for a new engineer
