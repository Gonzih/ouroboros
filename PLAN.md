# PLAN — Integration Verification Pass

## Task Summary
Run `pnpm install && pnpm build && pnpm test` on the Ouroboros monorepo.
Fix any failures. Add CHANGELOG.md. Open and merge a PR.

## Approach
1. Smoke-check: run install, build, test in sequence
2. Triage any failures (TypeScript errors, Vitest issues, missing fields)
3. Fix root causes package-by-package
4. Add CHANGELOG.md
5. Open PR and merge

## Expected failure categories (from institutional knowledge)
- `noUncheckedIndexedAccess` array access errors
- `.js` extension missing on local imports
- Missing `composite: true` in tsconfig for workspace refs
- Vitest mock patterns in ESM

## Files likely to touch
- Any package with build/test failures
- CHANGELOG.md (new)

## Risks
- Build failures may cascade across packages (core must build first)
- ESM + Node16 resolution is strict about import extensions
