# Spec: packages/gateway

## Purpose
Telegram bridge. Inbound messages from user → Redis queues. Redis pub/sub notifications → Telegram messages. Gracefully degrades if no token configured.

## Commands

| Command | Action |
|---------|--------|
| `/status` | Reply with: active jobs count, last log line, meta-agent lock PID |
| `/logs` | Reply with last 10 log lines from `ouro:logs` |
| `/task <description>` | Push task to `ouro:tasks` with backend=git (default), return job id |
| `/feedback <text>` | Push to `ouro:feedback`, trigger Ouroboros loop |
| `/mcp list` | List registered MCPs from `ouro:mcp:registry` |
| Any other message | Push to `ouro:feedback` as-is (treat as free-form feedback) |

## Notification Subscription

Subscribes to `ouro:notify` pub/sub. On message:
```typescript
type NotifyPayload =
  | { type: 'job_complete'; jobId: string; status: 'completed' | 'failed' }
  | { type: 'evolution_done'; feedbackId: string; summary: string }
  | { type: 'mcp_registered'; name: string }
```

Formats and sends to TELEGRAM_CHAT_ID.

## Graceful Degradation

If `TELEGRAM_BOT_TOKEN` not set:
- Log "gateway: no TELEGRAM_BOT_TOKEN — running in log-only mode"
- Still subscribe to `ouro:notify` and log all events
- Accept no inbound commands (no bot to receive them)
- UI remains the only input channel

## Open Questions
- [ ] Should gateway accept tasks from any Telegram user or only TELEGRAM_CHAT_ID?
- [ ] Rate limiting on inbound commands? (e.g. one evolution at a time)
- [ ] Should `/task` require specifying backend, or always default to git?
