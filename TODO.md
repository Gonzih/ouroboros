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

## v0.3.0 — publish prep ✅ complete

- [x] npm publish prep: publishConfig + files field on all 5 publishable packages
- [x] Bump all package versions to 0.2.0
- [x] OIDC auth stub: OURO_OIDC_ISSUER wired in gateway (stub, logs issuer, placeholder for real middleware)
- [x] Installer scripts: scripts/install.sh (macOS launchd + Linux systemd) + scripts/install.ps1 (Windows Task Scheduler) — already complete from v0.2

## Next

- [ ] Push main branch to origin (currently 2 commits ahead)
- [ ] npm publish: run `pnpm -r publish --access public` once org namespace `@ouroboros` is claimed
- [ ] v0.4 scope: OIDC middleware implementation, gateway HTTP endpoint for /approve flow, worker heartbeat dashboard in UI
