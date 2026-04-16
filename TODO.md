# TODO: Vitest Tests Across All Packages

- [x] Create branch feat/tests
- [x] Update PLAN.md and TODO.md
- [ ] Update root package.json (add vitest devDeps)
- [ ] packages/core: update package.json, create vitest.config.ts, create __tests__
- [ ] packages/mcp-factory: update package.json, create vitest.config.ts, create __tests__
- [ ] packages/worker: update package.json, create vitest.config.ts, create __tests__
- [ ] packages/meta-agent: update package.json, create vitest.config.ts, create __tests__
- [ ] packages/gateway: update package.json, create vitest.config.ts, create __tests__
- [ ] packages/ui: update package.json, create vitest.config.ts, create server/app.ts, update server/index.ts, create server/__tests__
- [ ] pnpm install
- [ ] pnpm test — fix failures
- [ ] pnpm build — verify no regressions
- [ ] commit and create PR

---

# (Previous TODO) packages/gateway Implementation

- [x] Write PLAN.md (gateway)
- [ ] git checkout -b feat/gateway
- [ ] Create packages/gateway/package.json
- [ ] Create packages/gateway/tsconfig.json
- [ ] Create src/adapters/log.ts (always-active stdout + DB logger)
- [ ] Create src/adapters/telegram.ts (polling bot, inbound commands)
- [ ] Create src/adapters/slack.ts (outbound only)
- [ ] Create src/adapters/webhook.ts (generic outbound POST)
- [ ] Create src/gateway.ts (Gateway class, broadcast, LISTEN/NOTIFY bridge)
- [ ] Create src/index.ts (start() entrypoint)
- [ ] pnpm install (from repo root)
- [ ] pnpm --filter @ouroboros/core build
- [ ] pnpm --filter @ouroboros/gateway build — must compile without errors
- [ ] Fix any TypeScript errors
- [ ] git add packages/gateway && git commit
- [ ] git push -u origin feat/gateway
- [ ] gh pr create and merge
