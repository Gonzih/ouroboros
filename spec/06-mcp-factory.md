# Spec: packages/mcp-factory

## Purpose
Registers new data sources as MCP servers at runtime. Parses a connection string, generates the MCP server config, writes it to Redis and patches ~/.claude.json. Makes private data sources into tool-accessible context for any claude subprocess.

## Connection String Schemes

| Scheme | Example | MCP Generated |
|--------|---------|---------------|
| `redis://` | `redis://localhost:6379/0` | redis MCP (read keys as tools) |
| `pg://` or `postgres://` | `pg://user:pass@host/db` | postgres MCP (query as tool) |
| `file:///path` | `file:///Users/me/docs` | filesystem MCP (read files as tools) |
| `github://owner/repo` | `github://Gonzih/ouroboros` | GitHub repo MCP |
| `gdrive://folder-id` | `gdrive://1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs` | Google Drive MCP (stub v1) |
| `s3://bucket/prefix` | `s3://my-bucket/data/` | S3 MCP (stub v1) |

## HTTP API

```
POST /mcp/register
  body: { name: string, connectionString: string }
  response: { success: true, config: McpConfig } | { error: string }

GET /mcp/list
  response: McpConfig[]

DELETE /mcp/:name
  response: { success: true }
```

## Registration Flow

1. Parse connection string → determine scheme
2. Generate `mcpServers` entry for `~/.claude.json`
3. Write to `ouro:mcp:registry` hash (key=name, value=JSON McpConfig)
4. Publish to `ouro:notify`: `{ type: 'mcp_registered', name }`
5. Meta-agent picks up notification → patches `~/.claude.json` project scope

## ~/.claude.json Patch

```json
{
  "projects": {
    "/path/to/ouroboros": {
      "mcpServers": {
        "{name}": { ...generated config }
      }
    }
  }
}
```

## Generated Configs by Scheme

```typescript
// file:///path → filesystem MCP
{ command: "npx", args: ["-y", "@modelcontextprotocol/server-filesystem", path] }

// github://owner/repo → github MCP
{ command: "npx", args: ["-y", "@modelcontextprotocol/server-github"],
  env: { GITHUB_PERSONAL_ACCESS_TOKEN: process.env.GITHUB_TOKEN } }

// pg://... → postgres MCP
{ command: "npx", args: ["-y", "@modelcontextprotocol/server-postgres", connectionString] }

// redis://... → (custom, TBD — no official redis MCP yet)
// stub: log "redis MCP not yet available, storing config only"
```

## Open Questions
- [ ] How does meta-agent detect new registry entries — polling or pub/sub?
- [ ] Should mcp-factory also handle deregistration (remove from claude.json)?
- [ ] What happens when two packages register the same MCP name — error or overwrite?
- [ ] Should generated configs be validated (test MCP starts) before writing?
- [ ] gdrive and s3 MCPs don't have official packages yet — prioritize file/github/postgres for v1
