# Spec: packages/gateway

## Purpose
Communication channel abstraction. Inbound messages from any channel → Redis queues. Redis pub/sub notifications → outbound messages on all registered channels. Telegram is one adapter, not the definition.

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
- Inbound: messages → `ouro:feedback` or `ouro:tasks` based on command prefix
- Outbound: notifications from `ouro:notify`

### Slack
- Required: `SLACK_BOT_TOKEN`, `SLACK_CHANNEL_ID`
- Uses Slack Web API (`@slack/web-api`)
- Same inbound/outbound pattern as Telegram
- v1: outbound notifications only (no slash command handling yet)

### Webhook (generic outbound)
- Required: `OURO_WEBHOOK_URL`
- POSTs JSON `{ text, type, ts }` to configured URL on every `ouro:notify` event
- Covers email (via Zapier/Make), Discord (Discord webhook URL), Teams, etc.

### Log-only (always active)
- No env vars required
- Subscribes to `ouro:notify`, logs every event to stdout + `ouro:logs`
- Fallback when no real adapter is configured

## Inbound Commands (all adapters that support text input)

| Input | Action |
|-------|--------|
| `/status` | Active jobs count, meta-agent PID, last log line |
| `/logs` | Last 10 lines from `ouro:logs` |
| `/task <backend> <target> <description>` | Push to `ouro:tasks` |
| `/task <description>` | Push to `ouro:tasks` with default backend=git |
| `/feedback <text>` | Push to `ouro:feedback` (Ouroboros loop) |
| `/mcp list` | List registered MCPs |
| `/approve <feedbackId>` | Approve a pending evolution for merge |
| `/reject <feedbackId> <reason>` | Reject a pending evolution |
| Any other text | Treated as free-form feedback → `ouro:feedback` |

## Notification Subscription

Subscribes to `ouro:notify` Redis pub/sub. Forwards all events to all active adapters.

```typescript
type NotifyPayload =
  | { type: 'job_complete'; jobId: string; status: 'completed' | 'failed'; summary?: string }
  | { type: 'evolution_proposed'; feedbackId: string; prUrl: string; diff: string }
  | { type: 'evolution_applied'; feedbackId: string; prUrl: string; summary: string }
  | { type: 'evolution_rejected'; feedbackId: string; reason: string }
  | { type: 'mcp_registered'; name: string; operational: boolean }

```

## evolution_proposed Flow (approval gate)

When meta-agent opens a PR for an evolution:
1. Gateway receives `evolution_proposed` with PR URL + diff summary
2. Sends notification to all channels: "Ouroboros updated itself. Here's what changed: [diff]. Approve with /approve {id} or reject with /reject {id} reason"
3. Stores pending state in `ouro:feedback:{id}:approval`
4. On `/approve`: meta-agent merges PR, sends `evolution_applied` notification
5. On `/reject`: meta-agent closes PR, sends `evolution_rejected` notification
6. User verifies system still works — they are QA

## Graceful Degradation
- If no adapters configured: log-only mode, stdout only
- If one adapter fails: continue with others, log the error
- Gateway never crashes the meta-agent — it runs as a separate process
