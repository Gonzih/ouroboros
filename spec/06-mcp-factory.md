# Spec: packages/mcp-factory

## Purpose
Registers data sources as MCP servers at runtime. Parses a connection string, generates MCP config, **validates that the MCP actually works** by testing it with a live Claude instance, then writes to Redis and patches ~/.claude.json.

## Connection String Schemes (v1)

| Scheme | Example | MCP Package |
|--------|---------|-------------|
| `file:///path` | `file:///Users/me/docs` | `@modelcontextprotocol/server-filesystem` |
| `github://owner/repo` | `github://Gonzih/ouroboros` | `@modelcontextprotocol/server-github` |
| `pg://` / `postgres://` | `pg://user:pass@host/db` | `@modelcontextprotocol/server-postgres` |
| `gdrive://folder-id` | `gdrive://1BxiMVs0XRA` | rclone-based (stub v1) |
| `s3://bucket/prefix` | `s3://my-data/docs/` | AWS MCP (stub v1) |
| `onedrive://path` | `onedrive://Documents/data` | rclone-based (stub v1) |

## HTTP API

```
POST /mcp/register
  body: { name: string, connectionString: string }
  → parse → generate config → validate → register
  response: { success: true, config: McpConfig, validation: ValidationResult }
           | { error: string, validationLog?: string }

GET  /mcp/list
  response: McpConfig[]  (includes operational: boolean from last validation)

POST /mcp/test/:name
  → re-run validation on existing MCP
  response: ValidationResult

DELETE /mcp/:name
  → remove from ouro:mcp:registry, patch claude.json to remove entry
  response: { success: true }
```

## MCP Validation — Core Feature

Before writing anything to Redis or claude.json, mcp-factory **proves the MCP works**:

### Validation Flow

```
1. Generate mcpServers config entry for the connection string
2. Write a temporary claude.json to /tmp/ouro-mcp-test-{name}.json
3. Spawn: claude --print --dangerously-skip-permissions \
     --mcp-config /tmp/ouro-mcp-test-{name}.json \
     -p "List all available MCP tools. For each tool, call it with a simple test invocation. Report: OPERATIONAL if all tools respond, PARTIAL if some fail, FAILED if none respond."
4. Parse output for OPERATIONAL / PARTIAL / FAILED marker
5. Record validation result: { status, toolsFound: string[], failedTools: string[], log: string }
6. If FAILED: return error to caller, do not register
7. If OPERATIONAL or PARTIAL: register and note partial status
8. Clean up temp config file
```

### What "operational" means per scheme

| Scheme | Test invocation |
|--------|----------------|
| `file:///path` | `list_directory(path)` — verify directory listing works |
| `github://` | `list_repos` or `get_file_contents` on README.md |
| `pg://` | `query("SELECT 1")` — verify connection |
| others | `list_tools()` — verify MCP starts and exposes at least one tool |

### Validation timeout
30 seconds max. If claude subprocess doesn't produce a result marker in 30s: treat as FAILED.

## Registration Flow (post-validation)

```
1. Write to ouro:mcp:registry hash: key=name, value=JSON McpConfig
2. Patch ~/.claude.json:
   projects[repoRoot].mcpServers[name] = generatedConfig
   (atomic: read → merge → write, no concurrent writes — use file lock via ouro:claude-json:lock)
3. Publish to ouro:notify: { type: 'mcp_registered', name, operational: true/false }
4. Meta-agent receives notification → logs it, optionally restarts relevant subprocess
```

## Conflict Handling
- If `name` already exists in registry: overwrite (treat as update)
- Log the replacement with old config for auditability

## Open Questions (resolved)
- ✅ Validate before register: yes — heavy testing via live Claude instance
- ✅ Conflict on same name: overwrite, log old config
- ✅ gdrive/s3/OneDrive: stubbed in v1, MCP config stored but marked unvalidated
- ⬜ Deregistration: removes from redis + claude.json — implement in v1
