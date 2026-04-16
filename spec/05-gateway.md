# Spec: packages/gateway

## Purpose
Communication channel abstraction. Inbound messages from any channel → Postgres queues (pgmq). LISTEN/NOTIFY events → outbound messages on all registered channels. Telegram is one adapter, not the definition.

## Channel Abstraction

```typescript
interface ChannelAdapter {
  name: string                                   // 'telegram', 'slack', 'discord', 'email', 'webhook'
  send(message: string): Promise<void>           // outbound notification
  start(): Promise<void>                         // begin listening for inbound
  stop(): Promise<void>
}
```

Each adapter is loaded if its required env vars are present. Multiple adapters can run simultaneously — a message posted to Telegram also goes to Slack if both are configured.

## Adapters (v1)

### Telegram
- Required: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`
- Uses `node-telegram-bot-api`
- Inbound: messages → `ouro_tasks` or `ouro_feedback` pgmq queues based on command prefix
- Outbound: notifications from `ouro_notify` LISTEN/NOTIFY channel

### Slack
- Required: `SLACK_BOT_TOKEN`, `SLACK_CHANNEL_ID`
- Uses Slack Web API (`@slack/web-api`)
- Same inbound/outbound pattern as Telegram
- v1: outbound notifications only (no slash command handling yet)

### Webhook (generic outbound)
- Required: `OURO_WEBHOOK_URL`
- POSTs JSON `{ text, type, ts }` to configured URL on every `ouro_notify` event
- Covers email (via Zapier/Make), Discord (Discord webhook URL), Teams, etc.

### Log-only (always active)
- No env vars required
- Subscribes to `ouro_notify`, logs every event to stdout + `ouro_logs`
- Fallback when no real adapter is configured

## Inbound Commands (all adapters that support text input)

| Input | Action |
|-------|--------|
| `/status` | Active jobs count, meta-agent PID, last log line |
| `/logs` | Last 10 lines from `ouro_logs` |
| `/task <backend> <target> <description>` | Push to `ouro_tasks` pgmq queue |
| `/task <description>` | Push to `ouro_tasks` with default backend=git |
| `/feedback <text>` | Push to `ouro_feedback` pgmq queue (Ouroboros loop) |
| `/mcp list` | List registered MCPs |
| `/approve <feedbackId>` | Approve a pending evolution for merge |
| `/reject <feedbackId> <reason>` | Reject a pending evolution |
| Any other text | Treated as free-form feedback → `ouro_feedback` |

## Notification Subscription

Gateway subscribes to the `ouro_notify` LISTEN/NOTIFY channel (via `subscribe()` from `@ouroboros/core`). Forwards all events to all active adapters.

```typescript
type NotifyPayload =
  | { type: 'job_complete'; jobId: string; status: 'completed' | 'failed'; summary?: string }
  | { type: 'evolution_proposed'; feedbackId: string; prUrl: string; diff: string }
  | { type: 'evolution_applied'; feedbackId: string; prUrl: string; summary: string }
  | { type: 'evolution_rejected'; feedbackId: string; reason: string }
  | { type: 'mcp_registered'; name: string; operational: boolean }
  | { type: 'job_requeued'; jobId: string; reason: string }
  | { type: 'restarting'; reason: string }
```

## evolution_proposed Flow (approval gate)

When meta-agent opens a PR for an evolution:
1. Gateway receives `evolution_proposed` with PR URL + diff summary
2. Sends notification to all channels: "Ouroboros updated itself. Here's what changed: [diff]. Approve with /approve {id} or reject with /reject {id} reason"
3. On `/approve`: UPDATE `ouro_feedback SET status='approved'` — meta-agent merges, rebuilds, restarts
4. On `/reject`: UPDATE `ouro_feedback SET status='rejected'` — meta-agent closes PR
5. User verifies system still works — they are QA

## Graceful Degradation
- If no adapters configured: log-only mode, stdout only
- If one adapter fails: continue with others, log the error
- Gateway never crashes the meta-agent — it runs as a separate process
- Gateway registers itself in `ouro_processes` on startup; watchdog loop detects and restarts it if dead
