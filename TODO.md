# TODO: packages/gateway Implementation

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
