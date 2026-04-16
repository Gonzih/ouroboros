# Spec: packages/mcp-factory

## Purpose
The primary value package of Ouroboros. Connects customer proprietary data sources to Claude Code as MCP tools — without the customer writing any integration code. Give it a connection string, it figures out the rest and proves it works.

## Core Principle
Data never leaves the customer's machine. The MCP server runs locally. Claude Code connects to it locally. The enterprise Anthropic account ensures the model inference is org-scoped. No third party sees the data.

## Connection String Schemes

| Scheme | Example | MCP Package | Status |
|--------|---------|-------------|--------|
| `pg://` / `postgres://` | `pg://user:pass@host/db` | `@modelcontextprotocol/server-postgres` | v1 |
| `file:///path` | `file:///data/reports` | `@modelcontextprotocol/server-filesystem` | v1 |
| `github://owner/repo` | `github://acme/internal-wiki` | `@modelcontextprotocol/server-github` | v1 |
| `sqlite:///path` | `sqlite:///app.db` | `@modelcontextprotocol/server-sqlite` | v1 |
| `s3://bucket/prefix` | `s3://corp-data/docs/` | `@modelcontextprotocol/server-aws-kb-retrieval` | stub |
| `gdrive://folder-id` | `gdrive://1BxiMVs0XRA` | rclone-based | stub |
| `onedrive://path` | `onedrive://Documents/data` | rclone-based | stub |
| `http://` / `https://` | `https://api.internal/v1` | custom OpenAPI MCP | stub |

## HTTP API (port 7703)

```
POST /mcp/register
  body: { name: string, connectionString: string }
  → parse → generate config → validate → persist
  response: { success: true, config: McpConfig, validation: ValidationResult }
           | { error: string, validationLog: string }

GET  /mcp/list
  → SELECT * FROM ouro_mcp_registry ORDER BY registered_at DESC
  response: McpConfig[]

POST /mcp/test/:name
  → re-run validation on existing registered MCP
  response: ValidationResult

DELETE /mcp/:name
  → DELETE FROM ouro_mcp_registry WHERE name = $1
  → remove from ~/.claude.json project scope
  response: { success: true }
```

## MCP Validation — The Critical Step

Before writing anything to the database or claude.json, mcp-factory **proves the MCP works using Claude**.

### Why Claude for validation
We can't just `npx` the MCP server and check if it starts — we need to know that the tools are actually functional end-to-end. The only way to test that is to have Claude connect to it and call the tools. This also means validation catches data permission issues, connection string errors, and schema problems that a startup check would miss.

### Validation Flow

```
1. Parse connection string → determine scheme → generate mcpServers config
2. Write temp config: /tmp/ouro-validate-{name}-{uuid}.json
   {
     "mcpServers": {
       "{name}": { ...generated config }
     }
   }
3. Build validation prompt:
   "You have access to an MCP server called {name} (scheme: {scheme}).
    List all available tools from this MCP.
    For each tool, call it with a minimal safe test invocation (read-only, no mutations).
    Postgres: SELECT 1 and list tables.
    Filesystem: list the root directory.
    GitHub: get repository info.
    SQLite: list tables.
    
    Report exactly one of:
    OPERATIONAL — all tools responded correctly
    PARTIAL — some tools work, some failed (list which)
    FAILED — no tools responded or MCP did not start
    
    Include tool names found and any error messages."

4. spawnSync claude:
   claude --print --dangerously-skip-permissions \
     --mcp-config /tmp/ouro-validate-{name}-{uuid}.json \
     -p "{prompt}"
   timeout: 45 seconds
   
5. Parse output for OPERATIONAL / PARTIAL / FAILED marker
6. Extract tool names and error messages from output
7. Delete temp config file
8. If FAILED: return error, do not register
9. If OPERATIONAL or PARTIAL: proceed to registration
```

### Validation Result

```typescript
interface ValidationResult {
  status: 'operational' | 'partial' | 'failed'
  toolsFound: string[]
  failedTools: string[]
  log: string           // full claude output for debugging
  durationMs: number
}
```

## Registration Flow (post-validation)

```
1. INSERT INTO ouro_mcp_registry (name, connection_string, server_config, status, ...)
2. Patch ~/.claude.json:
   - Read file (or create if missing)
   - Merge: projects[OURO_REPO_ROOT].mcpServers[name] = serverConfig
   - Write atomically (write to tmp, rename)
3. NOTIFY 'ouro_notify', JSON({ type: 'mcp_registered', name, status })
4. Return McpConfig to caller
```

## Generated Configs by Scheme

```typescript
// pg:// or postgres://
{
  command: "npx",
  args: ["-y", "@modelcontextprotocol/server-postgres", connectionString]
}

// file:///path
{
  command: "npx",
  args: ["-y", "@modelcontextprotocol/server-filesystem", path]
}

// github://owner/repo
{
  command: "npx",
  args: ["-y", "@modelcontextprotocol/server-github"],
  env: { GITHUB_PERSONAL_ACCESS_TOKEN: process.env.GITHUB_TOKEN ?? "" }
}

// sqlite:///path
{
  command: "npx",
  args: ["-y", "@modelcontextprotocol/server-sqlite", "--db-path", path]
}
```

## claude.json Patching (cross-platform)

```typescript
const claudeJsonPath = path.join(os.homedir(), '.claude.json')

// Read → merge → atomic write
const current = existsSync(claudeJsonPath)
  ? JSON.parse(readFileSync(claudeJsonPath, 'utf8'))
  : {}

const repoRoot = process.env.OURO_REPO_ROOT!
set(current, ['projects', repoRoot, 'mcpServers', name], serverConfig)

const tmp = claudeJsonPath + '.tmp'
writeFileSync(tmp, JSON.stringify(current, null, 2))
renameSync(tmp, claudeJsonPath)  // atomic on POSIX; near-atomic on Windows
```

## Deregistration

```
DELETE FROM ouro_mcp_registry WHERE name = $1
→ remove from ~/.claude.json (read → delete key → atomic write)
→ NOTIFY 'ouro_notify', JSON({ type: 'mcp_removed', name })
```
