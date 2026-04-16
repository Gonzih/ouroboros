# Ouroboros — System Overview

## Core Purpose

Ouroboros connects proprietary customer data to Claude Code via dynamically provisioned MCP servers. It runs entirely on customer hardware. No data leaves the customer's infrastructure. No direct LLM API calls — all intelligence goes through the `claude` CLI under an enterprise Anthropic account.

The primary value is **MCP provisioning**: a customer has a Postgres database, a folder of PDFs, a Google Drive, an internal API — Ouroboros registers these as MCP tools so Claude can reason over them. The customer doesn't write code to do this. They give Ouroboros a connection string and it figures out the rest.

The secondary value is **autonomous agents**: once Claude has access to the data via MCPs, Ouroboros can spawn workers that use those tools to do real work — analysis, reports, transformations, code generation.

The tertiary value is **self-evolution**: the system improves itself based on user feedback, with the user as QA.

---

## Who Runs This

An enterprise or power user who:
- Has proprietary data they cannot send to a cloud API
- Has an Anthropic enterprise account (Claude stays within their org)
- Wants Claude to reason over their private data without writing glue code
- Runs macOS, Linux, or Windows

---

## The Three Loops

### Loop 1 — MCP Provisioning (primary)
```
customer has data source (DB, folder, Drive, API)
  → register via UI or gateway: "connect my Postgres at pg://..."
  → mcp-factory parses connection string
  → generates MCP server config
  → spawns claude with temp config: "test all tools, report OPERATIONAL/PARTIAL/FAILED"
  → if operational: writes to ouro_mcp_registry table
  → patches ~/.claude.json project scope
  → notifies user: "your Postgres is now available as MCP tools"
  → next claude subprocess can query that database as a tool
```

### Loop 2 — Worker Dispatch
```
user submits task: "analyze last week's sales data and write a report"
  → pushed to pgmq ouro_tasks queue
  → meta-agent dequeues
  → spawns worker subprocess with task + available MCP tools in context
  → worker runs claude: uses registered MCPs to query data, writes output
  → progress streamed to ouro_jobs table
  → completion published via NOTIFY 'ouro_notify'
  → gateway sends user notification with result
```

### Loop 3 — Self-Evolution (Ouroboros)
```
user submits feedback: "add a dark mode toggle to the UI"
  → pushed to pgmq ouro_feedback queue
  → meta-agent dequeues
  → spawns claude subprocess at OURO_REPO_ROOT: implement this, open PR
  → PR opens → user gets diff via gateway → user /approve
  → meta-agent merges → rebuilds → restarts affected package
  → user verifies it works → they are QA
```

---

## What Makes This Different

| Property | Typical AI Tool | Ouroboros |
|----------|----------------|-----------|
| Data locality | Leaves the machine | Never leaves machine |
| LLM access | Direct API calls | Claude CLI only (enterprise account) |
| Data connections | Manual integration code | MCP provisioned from connection string |
| Storage dependency | Redis / cloud DB | Postgres only (self-hosted) |
| Platform | Cloud or Mac-only | macOS, Linux, Windows |
| Evolution | Static | Self-modifying with user approval |

---

## What Ouroboros Is NOT

- Not a general-purpose cloud SaaS
- Not a replacement for Claude Code — it wraps and orchestrates it
- Not making direct LLM API calls (this is a hard constraint, not a preference)
- Not storing data in the cloud — Postgres runs on the customer's machine
- Not requiring internet access to function (except for Claude API calls under enterprise account)
