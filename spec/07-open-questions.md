# Open Questions — Needs Decisions Before Implementation

Track all unresolved design decisions here. Each question should be answered before the relevant package is implemented.

---

## Meta-Agent

### OQ-01: Self-evolution safety
Should feedback auto-merge or require a review step?
- Option A: Always auto-merge (fastest, most autonomous, risky)
- Option B: Open PR, notify user, wait for approval (safe, breaks autonomy)
- Option C: Auto-merge if `pnpm build` passes, else notify and wait

**Current lean:** Option C — build gate gives a safety net without breaking the loop.

### OQ-02: Evolution rate limiting
Unchecked feedback could trigger infinite self-modification loops.
- Max 1 evolution per 5 minutes?
- Max depth (evolution triggered by evolution)?
- Dead-letter queue for failed evolutions?

### OQ-03: Worker isolation
Subprocess vs cc-agent for worker dispatch?
- Subprocess: simpler, shares memory space, no isolation
- cc-agent: full isolation, own git clone, proper job lifecycle tracking
- **Current lean:** cc-agent for git backend (already exists), subprocess for local backend

---

## Worker

### OQ-04: Local backend git behavior
If a local folder has no `.git`, should worker:
- A: `git init` it automatically
- B: Operate without git (changes made but not versioned)
- C: Refuse with an error

### OQ-05: Worker timeout
Claude tasks can run 10-30 minutes. What's the max?
- **Suggested:** 30 minutes, configurable via `OURO_WORKER_TIMEOUT_MS`

---

## UI

### OQ-06: Authentication
- Option A: No auth (local tool, trust the network)
- Option B: Single hardcoded API key in env (`OURO_API_KEY`)
- Option C: Full auth system (out of scope for v1)

**Current lean:** Option B — simple env key, UI checks header.

### OQ-07: Live updates mechanism
- SSE: simple, uni-directional, works with Next.js
- WebSocket: bi-directional, more complex
- Polling: resilient, easy to implement
- **Current lean:** SSE for logs/jobs, polling fallback if SSE unavailable

---

## MCP Factory

### OQ-08: MCP validation before registration
Should mcp-factory test that the MCP server actually starts before writing to claude.json?
- Pro: catches bad configs early
- Con: MCP startup can be slow (npx download)

### OQ-09: claude.json write conflicts
If two packages both write to claude.json simultaneously:
- Use file lock?
- Write through Redis only, one writer patches the file?

---

## Storage

### OQ-10: S3 and Google Drive priority
These are stubs in v1. When should they be implemented?
- **Defer until:** a user specifically asks for them via feedback (let the Ouroboros loop build them)

---

## General

### OQ-11: Multi-machine deployment
v1 assumes single machine (Redis local, claude binary local, ~/.claude.json local).
Should v1 have any concessions for multi-machine?
- **Current lean:** No. Single machine for v1. Multi-machine is a future spec.

### OQ-12: Versioning and release
Each package is `@ouroboros/core`, `@ouroboros/meta-agent`, etc.
- Publish to npm (public)?
- Keep private?
- **Current lean:** Public npm under `@ouroboros/*` namespace, publish after v1 is stable.
