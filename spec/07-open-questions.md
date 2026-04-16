# Open Questions — Decision Log

All 12 original questions are now resolved. Recording decisions and rationale here.

---

## Meta-Agent

### OQ-01: Self-evolution safety ✅ DECIDED
**Decision:** Auto-merge with user-as-QA approval gate.

Flow:
1. Meta-agent implements feedback, opens PR
2. Gateway sends `evolution_proposed` notification to all channels: "Here's what changed [diff]. Approve with /approve {id}"
3. User is QA — they verify the system still works and approve
4. On `/approve`: meta-agent merges. On `/reject`: PR closed.

PR is never auto-merged without user approval. The user sees the diff and tests before confirming.

### OQ-02: Evolution rate limiting ✅ DECIDED
**Decision:** Approval-based, not time-based.

Since user must approve every evolution before merge, there's an implicit rate limit — the user can only approve one at a time. No separate time throttle needed. Multiple pending evolutions can be queued; user works through them in order.

Dead-letter: if an evolution PR stays unreviewed for 7 days, auto-close and log.

---

## Worker

### OQ-03: Worker isolation ✅ DECIDED
**Decision:** Subprocess (not cc-agent).

Simpler, sufficient for v1. cc-agent adds overhead and a dependency on the cc-agent service being up. Workers are short-lived and isolated by the storage backend's `prepare/cleanup` cycle anyway.

### OQ-04: Local backend git behavior ✅ DECIDED
**Decision:** Auto git-init.

If target folder has no `.git`: run `git init && git add -A && git commit -m "ouro: initial commit before task"` automatically. User gets a git history of all changes Ouroboros made to their folder.

### OQ-05: Worker timeout ✅ DECIDED
**Decision:** No hard timeout.

Task runs until claude exits. Progress streamed live to UI + gateway. If no output for > 10 minutes, log a heartbeat warning ("worker {id}: still running, last output 10m ago") but do not kill. User sees what's happening at all times.

---

## UI

### OQ-06: Authentication ✅ DECIDED
**Decision:** No auth for v1. Future: OpenID Connect SSO via single env var `OURO_OIDC_ISSUER`.

### OQ-07: Live updates mechanism ✅ DECIDED
**Decision:** WebSocket (matching cc-agent-ui pattern).

SSE was considered but WebSocket enables bi-directional commands (subscribe/unsubscribe to specific job streams). Already a dependency in cc-agent-ui.

### OQ-08: UI framework ✅ DECIDED
**Decision:** Vanilla JS, single index.html, Node.js HTTP server — same stack as cc-agent-ui.

No React, no Vue, no Next.js. The meta-agent needs to be able to modify the UI with a text editor. Single file = trivially modifiable. JetBrains Mono, dark terminal aesthetic.

---

## MCP Factory

### OQ-09 (was OQ-08): MCP validation ✅ DECIDED
**Decision:** Heavy validation — spawn Claude with temp MCP config, force it to test every tool endpoint, classify as OPERATIONAL / PARTIAL / FAILED. Only register if OPERATIONAL or PARTIAL. FAILED returns error to caller.

### OQ-10 (was OQ-09): claude.json write conflicts ✅ DECIDED
**Decision:** Redis lock (`ouro:claude-json:lock`, TTL 10s) before read-merge-write. Single writer at a time.

---

## Storage

### OQ-11 (was OQ-10): S3 / Google Drive / OneDrive priority ✅ DECIDED
**Decision:** Stub in v1. All three business storage types (S3, GDrive, OneDrive) are wired in the StorageBackend interface but return "not yet implemented" in v1. Implement via the Ouroboros feedback loop when a user needs them — dog-food the system.

---

## General

### OQ-12 (was OQ-11): Multi-machine ✅ DECIDED
**Decision:** Single machine for v1. One Redis, one claude binary, one ~/.claude.json. Multi-machine is a future spec.

### OQ-13 (was OQ-12): npm publishing ✅ DECIDED
**Decision:** Public npm under `@ouroboros/*` namespace. Publish after v1 is stable and tested. Goal: teach users how to run self-evolving infrastructure. That's the age we're in.
