# TODO

## v0.2.0 — meta-agent v2 ✅ complete

- [x] Write PLAN.md and TODO.md
- [x] Create packages/meta-agent/src/coordinator.ts
- [x] Update packages/meta-agent/src/index.ts (coordinator loop + legacy fallback)
- [x] Write packages/meta-agent/src/__tests__/coordinator.test.ts
- [x] Update .gitignore (add .ouro-session, logs/, *.err)
- [x] Update .env.example (add OURO_LEGACY_LOOPS)
- [x] Build and test clean
- [x] Dockerfile.postgres — custom image with pgmq built from source
- [x] docker-compose.yml — build from Dockerfile.postgres
- [x] meta-agent self-invocation (void start() in dist/index.js)

## Next

- [ ] Push main branch (1 commit ahead of origin)
- [ ] v0.3 scope: installer script, npm publish prep, OIDC auth stub
