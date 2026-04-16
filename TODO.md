# TODO: packages/meta-agent Implementation

- [ ] Create src/claude.ts (cross-platform binary finder)
- [ ] Create src/loops/mcp-watch.ts (LISTEN/NOTIFY subscriber)
- [ ] Create src/loops/worker-dispatch.ts (pgmq poll + subprocess spawn)
- [ ] Create src/loops/evolution.ts (feedback poll + spawnSync claude + approval gate)
- [ ] Rewrite src/index.ts (startup, lock, crash recovery, orchestration)
- [ ] Create src/test/meta-agent.test.ts (unit tests)
- [ ] git checkout -b feat/meta-agent
- [ ] pnpm build (verify clean compile)
- [ ] pnpm test (verify tests pass)
- [ ] git commit and push
- [ ] gh pr create and merge
