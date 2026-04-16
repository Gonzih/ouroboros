# TODO: meta-agent v2

- [x] Write PLAN.md and TODO.md
- [ ] Create git branch feat/meta-agent-v2
- [ ] Create packages/meta-agent/src/coordinator.ts
- [ ] Update packages/meta-agent/src/index.ts (coordinator loop + legacy fallback)
- [ ] Write packages/meta-agent/src/__tests__/coordinator.test.ts
- [ ] Update .gitignore (add .ouro-session, logs/, *.err)
- [ ] Update .env.example (add OURO_LEGACY_LOOPS)
- [ ] pnpm install && pnpm --filter @ouroboros/core build && pnpm --filter @ouroboros/meta-agent build
- [ ] pnpm --filter @ouroboros/meta-agent test
- [ ] git commit
- [ ] gh pr create + gh pr merge --squash --auto
