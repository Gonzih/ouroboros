# TODO: Self-Healing / Watchdog / Session Continuity

- [x] git checkout -b feat/self-healing
- [ ] packages/core/src/migrations/002_self_healing.sql
- [ ] packages/core/src/process-registry.ts (7 functions)
- [ ] packages/core/src/types.ts — extend Job with pid/sessionId/lastHeartbeat
- [ ] packages/core/src/index.ts — re-export process-registry
- [ ] packages/meta-agent/src/loops/watchdog.ts (Loop 4)
- [ ] packages/meta-agent/src/index.ts — add watchdog loop + MetaAgentState
- [ ] packages/meta-agent/src/loops/evolution.ts — self-restart after applied
- [ ] packages/worker/src/run.ts — heartbeats + PID reg + --continue
- [ ] packages/core/src/__tests__/process-registry.test.ts
- [ ] packages/meta-agent/src/__tests__/watchdog.test.ts
- [ ] spec/08-self-healing.md
- [ ] pnpm build
- [ ] pnpm test
- [ ] git add -A && git commit && git push && gh pr create && gh pr merge
