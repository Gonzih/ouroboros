import { migrate, closeDb, log } from '@ouroboros/core'
import { LogAdapter } from './adapters/log.js'
import { TelegramAdapter } from './adapters/telegram.js'
import { SlackAdapter } from './adapters/slack.js'
import { WebhookAdapter } from './adapters/webhook.js'
import { Gateway } from './gateway.js'
import { startHttpServer } from './http.js'
import type { ChannelAdapter } from './adapters/log.js'

export async function start(): Promise<void> {
  await migrate()

  const adapters: ChannelAdapter[] = []

  // LogAdapter is always active
  adapters.push(new LogAdapter())

  // Telegram: requires TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID
  const telegramToken = process.env['TELEGRAM_BOT_TOKEN']
  const telegramChatId = process.env['TELEGRAM_CHAT_ID']
  if (telegramToken && telegramChatId) {
    adapters.push(new TelegramAdapter(telegramToken, telegramChatId))
  }

  // Slack: requires SLACK_BOT_TOKEN and SLACK_CHANNEL_ID
  const slackToken = process.env['SLACK_BOT_TOKEN']
  const slackChannelId = process.env['SLACK_CHANNEL_ID']
  if (slackToken && slackChannelId) {
    adapters.push(new SlackAdapter(slackToken, slackChannelId))
  }

  // Webhook: requires OURO_WEBHOOK_URL
  const webhookUrl = process.env['OURO_WEBHOOK_URL']
  if (webhookUrl) {
    adapters.push(new WebhookAdapter(webhookUrl))
  }

  // OIDC: stub — set OURO_OIDC_ISSUER to enable enterprise SSO (not active in v1)
  // When OIDC is implemented, wire middleware here before gateway.start()
  const oidcIssuer = process.env['OURO_OIDC_ISSUER']
  if (oidcIssuer) {
    await log('gateway', `OIDC issuer configured: ${oidcIssuer} (SSO not yet active — stub only)`)
  }

  startHttpServer()

  const gateway = new Gateway(adapters)

  const shutdown = async (): Promise<void> => {
    await log('gateway', 'shutting down')
    await gateway.stop()
    await closeDb()
    process.exit(0)
  }
  process.once('SIGTERM', () => { void shutdown() })
  process.once('SIGINT', () => { void shutdown() })

  await gateway.start()

  // Keep process alive — gateway runs indefinitely via LISTEN/NOTIFY subscription
  await new Promise<never>(() => undefined)
}
