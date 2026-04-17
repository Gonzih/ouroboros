import { migrate, closeDb, log, registerProcess, unregisterProcess, heartbeat } from '@ouroboros/core'
import { LogAdapter } from './adapters/log.js'
import { TelegramAdapter } from './adapters/telegram.js'
import { SlackAdapter } from './adapters/slack.js'
import { DiscordAdapter } from './adapters/discord.js'
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

  // Slack: requires SLACK_BOT_TOKEN and SLACK_CHANNEL_ID.
  // SLACK_SIGNING_SECRET enables inbound Events API support (/approve, /reject).
  const slackToken = process.env['SLACK_BOT_TOKEN']
  const slackChannelId = process.env['SLACK_CHANNEL_ID']
  let slackAdapter: SlackAdapter | undefined
  if (slackToken && slackChannelId) {
    slackAdapter = new SlackAdapter(slackToken, slackChannelId, process.env['SLACK_SIGNING_SECRET'])
    adapters.push(slackAdapter)
  }

  // Discord: requires DISCORD_BOT_TOKEN and DISCORD_CHANNEL_ID.
  // DISCORD_PUBLIC_KEY enables inbound Interactions API support (/approve, /reject, /status, /jobs).
  const discordToken = process.env['DISCORD_BOT_TOKEN']
  const discordChannelId = process.env['DISCORD_CHANNEL_ID']
  let discordAdapter: DiscordAdapter | undefined
  if (discordToken && discordChannelId) {
    discordAdapter = new DiscordAdapter(discordToken, discordChannelId, process.env['DISCORD_PUBLIC_KEY'], process.env['DISCORD_APPLICATION_ID'])
    adapters.push(discordAdapter)
  }

  // Webhook: requires OURO_WEBHOOK_URL
  const webhookUrl = process.env['OURO_WEBHOOK_URL']
  if (webhookUrl) {
    adapters.push(new WebhookAdapter(webhookUrl))
  }

  // startHttpServer handles OIDC middleware, optional Slack events route, and Discord interactions route
  await startHttpServer(slackAdapter, discordAdapter)

  const gateway = new Gateway(adapters)

  await registerProcess('gateway', process.pid, 'node', process.argv.slice(1))
  const heartbeatInterval = setInterval(() => { void heartbeat('gateway') }, 30_000)

  const shutdown = async (): Promise<void> => {
    clearInterval(heartbeatInterval)
    await log('gateway', 'shutting down')
    await unregisterProcess('gateway')
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

void start()
