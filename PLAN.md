# PLAN — Stateless coordinator cycles + shorter prompt + merge gate

## Task restatement

Four focused changes to the meta-agent coordinator:
1. **Shorter prompt** — cut `buildCoordinatorPrompt()` from ~200 words to ~80 words; remove `--continue`/v0.2 references; add `[coordinator:did-work]` output instruction; add `create_plan()` instruction; coordinator logs `[evolution:approved] <pr_url>` instead of merging.
2. **Stateless coordinator** — remove session file logic (`loadSessionId`, `saveSessionId`, `.ouro-session`). Every cycle spawns a fresh Claude process with `-p prompt`. No `--continue`/`--resume`.
3. **Evolution merge gate** — `pollForApproval` in `evolution.ts` currently auto-runs `gh pr merge` when it sees status='approved'. Change: transition status to 'merge_ready', publish notification, stop polling. Add new `merge_evolution(id)` MCP tool that humans call to perform the actual merge.
4. **`[coordinator:did-work]` parsing** — in `runCoordinatorLoop` (index.ts), scan output for `[coordinator:did-work]`; log idle if absent.

## Approaches considered

**Approach A (chosen):** Surgical edits to each file; minimal scope. coordinator.ts loses fs imports entirely. evolution.ts pollForApproval becomes a simple status transition. merge_evolution is a new tool in mcp-server/src/tools/feedback.ts.

**Approach B:** Move merge_evolution into meta-agent as an HTTP endpoint. More complex, cross-service; not needed.

**Approach C:** Keep session file but just stop using --continue. Wasteful; the whole session infrastructure becomes dead code.

## Files to touch

- `packages/meta-agent/src/coordinator.ts` — rewrite (Changes 1+2)
- `packages/meta-agent/src/index.ts` — add did-work parsing (Change 4)
- `packages/meta-agent/src/loops/evolution.ts` — remove auto-merge (Change 3)
- `packages/mcp-server/src/tools/feedback.ts` — add merge_evolution tool (Change 3)
- `packages/meta-agent/src/__tests__/coordinator.test.ts` — remove session tests, add new assertions
- `packages/mcp-server/src/__tests__/tools.test.ts` — add merge_evolution tests

## Risks and unknowns

- `merge_evolution` in mcp-server uses `spawnSync('gh', ...)` — gh CLI must be available in the deployment environment (same assumption as current evolution.ts code).
- `pollForApproval` background loop stops after seeing 'approved' → 'merge_ready'. If meta-agent restarts while status is 'merge_ready', no loop is watching it. The merge_evolution MCP tool handles it on demand, so this is acceptable.
- 'merge_ready' is a new status — needs to be added to the `list_feedback` enum.
