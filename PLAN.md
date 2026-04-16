# PLAN: packages/gateway — Full Implementation

## Task Restatement
Implement the notification/command gateway in `packages/gateway`. LISTEN/NOTIFY subscriber bridges Postgres events to outbound channels (Telegram, Slack, webhook, log). TelegramAdapter has full inbound command handling for approval workflow. All other adapters are outbound-only. Gateway starts all configured adapters based on env vars.

## Approaches Considered

### A: Single flat file with all adapters inline
Simple but messy — hard to read, hard to add new adapters.

### B: One adapter per file in src/adapters/ + src/gateway.ts + src/index.ts (chosen)
Each adapter is its own module. Gateway orchestrates. Matches spec file layout exactly.

### C: Plugin system with dynamic adapter loading
Over-engineered for v1 — static adapter loading is sufficient.

## Chosen Approach: B
Clean separation of concerns. Each adapter is independently readable. Matches spec exactly.

## Files to Create
- `packages/gateway/src/adapters/telegram.ts` — polling bot, inbound commands, outbound send
- `packages/gateway/src/adapters/slack.ts` — outbound only via Slack Web API or incoming webhook
- `packages/gateway/src/adapters/webhook.ts` — generic outbound POST
- `packages/gateway/src/adapters/log.ts` — always-active stdout + ouro_logs adapter
- `packages/gateway/src/gateway.ts` — Gateway class with broadcast + LISTEN/NOTIFY subscription
- `packages/gateway/src/index.ts` — start() entrypoint
- `packages/gateway/package.json`
- `packages/gateway/tsconfig.json`

## Key Design Decisions
- Adapters instantiated if and only if required env vars are present
- LogAdapter always active regardless of other adapters
- LISTEN/NOTIFY subscription via `subscribe()` from @ouroboros/core
- Telegram uses polling (setInterval + getUpdates) — no webhook server needed
- `node-telegram-bot-api` for Telegram (polling mode)
- Slack outbound via POST to SLACK_WEBHOOK_URL (simpler) or Web API if only bot token given
- All adapters implement ChannelAdapter interface
- Inbound Telegram commands routed to DB queries (approve/reject) or DB reads (status/jobs/mcp)
- broadcast() sends to all adapters, catches individual errors, continues
- ESM imports use `.js` extension
- All array accesses guarded due to `noUncheckedIndexedAccess: true`
- `exactOptionalPropertyTypes: true` — no `obj.prop = undefined`

## Event Routing (ouro_notify → message text)
- `mcp_registered` → "MCP {name} registered. Status: {status}. Tools: {tools}"
- `mcp_removed` → "MCP {name} removed."
- `job_complete` → "Job {jobId} {status}." (+ error if failed)
- `evolution_proposed` → full diff + approve/reject instructions
- `evolution_result` → "Evolution {id} {status}."

## Risks & Unknowns
- Slack: no SLACK_WEBHOOK_URL in env spec, only SLACK_BOT_TOKEN + SLACK_CHANNEL_ID — use Web API `chat.postMessage`
- node-telegram-bot-api in ESM context — may need careful import handling
- Polling offset tracking for Telegram to avoid re-processing updates
- `exactOptionalPropertyTypes` requires care with optional fields in type guards
