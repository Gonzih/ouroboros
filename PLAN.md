# PLAN: packages/mcp-factory — Full Implementation

## Task Restatement
Implement the primary value package of Ouroboros: mcp-factory. A customer provides a connection string; the system parses it, generates an MCP server config, validates it by spawning Claude with the config, persists the result to ouro_mcp_registry, patches ~/.claude.json, and exposes an HTTP API on port 7703.

## Approach

Single approach — implement all modules per spec, with testability built in via optional file path param for claude-json patching:

1. `parse.ts` — pure string parser, no I/O, easily testable
2. `generate.ts` — pure function mapping scheme → McpServerConfig
3. `validate.ts` — spawnSync claude subprocess with temp config
4. `claude-json.ts` — atomic read/patch/write of ~/.claude.json
5. `server.ts` — Express routes with Zod validation
6. `index.ts` — entry point wiring everything together

## Files to Touch
- packages/mcp-factory/package.json (add express, zod, @types/express)
- packages/mcp-factory/src/parse.ts (NEW)
- packages/mcp-factory/src/generate.ts (NEW)
- packages/mcp-factory/src/validate.ts (NEW)
- packages/mcp-factory/src/claude-json.ts (NEW)
- packages/mcp-factory/src/server.ts (NEW)
- packages/mcp-factory/src/index.ts (rewrite stub)
- packages/mcp-factory/src/test/parse.test.ts (NEW)
- packages/mcp-factory/src/test/generate.test.ts (NEW)
- packages/mcp-factory/src/test/claude-json.test.ts (NEW)

## Risks
- noUncheckedIndexedAccess: rows[0] returns T | undefined — must guard
- exactOptionalPropertyTypes: cannot set optional field to undefined explicitly
- Node16 module resolution: all relative imports need .js extension
- claude binary may not be on PATH in CI — validate.ts calls are tested structurally only
- Atomic rename on Windows: fs.renameSync overwrites destination atomically since Node 12.9 on Windows, so this should be fine
- GitHub token not in env for github:// scheme — handle gracefully
