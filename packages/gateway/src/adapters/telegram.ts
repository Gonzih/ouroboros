import TelegramBot from 'node-telegram-bot-api'
import { randomUUID } from 'node:crypto'
import { getDb, log, enqueue } from '@ouroboros/core'
import type { ChannelAdapter } from './log.js'

// Re-export for consumers that import from this module
export type { ChannelAdapter }

export class TelegramAdapter implements ChannelAdapter {
  readonly name = 'telegram'
  private bot: TelegramBot | null = null
  private token: string
  private chatId: string

  constructor(token: string, chatId: string) {
    this.token = token
    this.chatId = chatId
  }

  async send(message: string): Promise<void> {
    if (!this.bot) return
    try {
      await this.bot.sendMessage(this.chatId, message)
    } catch (err: unknown) {
      await log('gateway:telegram', `send failed: ${String(err)}`)
    }
  }

  async start(): Promise<void> {
    this.bot = new TelegramBot(this.token, { polling: true })

    this.bot.on('message', (msg) => {
      const text = msg.text ?? ''
      void this.handleCommand(text)
    })

    this.bot.on('polling_error', (err: unknown) => {
      void log('gateway:telegram', `polling error: ${String(err)}`)
    })

    await log('gateway:telegram', 'telegram adapter started (polling)')
  }

  async stop(): Promise<void> {
    if (this.bot) {
      await this.bot.stopPolling()
      this.bot = null
    }
  }

  private async handleCommand(text: string): Promise<void> {
    const trimmed = text.trim()

    if (trimmed.startsWith('/approve ')) {
      const id = trimmed.slice('/approve '.length).trim()
      if (!id) {
        await this.send('Usage: /approve {id}')
        return
      }
      await this.handleApprove(id)
    } else if (trimmed.startsWith('/reject ')) {
      const id = trimmed.slice('/reject '.length).trim()
      if (!id) {
        await this.send('Usage: /reject {id}')
        return
      }
      await this.handleReject(id)
    } else if (trimmed === '/status') {
      await this.handleStatus()
    } else if (trimmed === '/jobs') {
      await this.handleJobs()
    } else if (trimmed === '/mcp') {
      await this.handleMcp()
    } else if (trimmed === '/logs') {
      await this.handleLogs()
    } else if (trimmed.startsWith('/feedback ')) {
      const text = trimmed.slice('/feedback '.length).trim()
      if (text) await this.handleFeedback(text)
    }
    // other text: silently ignore — gateway is not a free-form input handler
  }

  private async handleApprove(id: string): Promise<void> {
    try {
      const db = getDb()
      const result = await db`
        UPDATE ouro_feedback SET status = 'approved' WHERE id = ${id} RETURNING id
      `
      if (result.length === 0) {
        await this.send(`No feedback found with id ${id}`)
      } else {
        await this.send(`Evolution ${id} approved.`)
      }
    } catch (err: unknown) {
      await log('gateway:telegram', `approve error: ${String(err)}`)
      await this.send(`Error approving ${id}: ${String(err)}`)
    }
  }

  private async handleReject(id: string): Promise<void> {
    try {
      const db = getDb()
      const result = await db`
        UPDATE ouro_feedback SET status = 'rejected' WHERE id = ${id} RETURNING id
      `
      if (result.length === 0) {
        await this.send(`No feedback found with id ${id}`)
      } else {
        await this.send(`Evolution ${id} rejected.`)
      }
    } catch (err: unknown) {
      await log('gateway:telegram', `reject error: ${String(err)}`)
      await this.send(`Error rejecting ${id}: ${String(err)}`)
    }
  }

  private async handleStatus(): Promise<void> {
    try {
      const db = getDb()
      const [jobStats] = await db<[{ running: string; pending: string; completed: string; failed: string }]>`
        SELECT
          COUNT(*) FILTER (WHERE status = 'running') AS running,
          COUNT(*) FILTER (WHERE status = 'pending') AS pending,
          COUNT(*) FILTER (WHERE status = 'completed') AS completed,
          COUNT(*) FILTER (WHERE status = 'failed') AS failed
        FROM ouro_jobs
      `
      const [mcpStats] = await db<[{ count: string }]>`
        SELECT COUNT(*) AS count FROM ouro_mcp_registry WHERE status = 'operational'
      `
      const running = jobStats?.running ?? '0'
      const pending = jobStats?.pending ?? '0'
      const completed = jobStats?.completed ?? '0'
      const failed = jobStats?.failed ?? '0'
      const mcpCount = mcpStats?.count ?? '0'

      await this.send(
        `Status:\n` +
        `Jobs — running: ${running}, pending: ${pending}, completed: ${completed}, failed: ${failed}\n` +
        `Active MCPs: ${mcpCount}`
      )
    } catch (err: unknown) {
      await log('gateway:telegram', `status error: ${String(err)}`)
      await this.send(`Error fetching status: ${String(err)}`)
    }
  }

  private async handleJobs(): Promise<void> {
    try {
      const db = getDb()
      const jobs = await db<{ id: string; description: string; status: string; created_at: Date }[]>`
        SELECT id, description, status, created_at
        FROM ouro_jobs
        ORDER BY created_at DESC
        LIMIT 5
      `
      if (jobs.length === 0) {
        await this.send('No jobs found.')
        return
      }
      const lines = jobs.map(j => `• [${j.status}] ${j.id}: ${j.description}`)
      await this.send(`Last ${jobs.length} jobs:\n${lines.join('\n')}`)
    } catch (err: unknown) {
      await log('gateway:telegram', `jobs error: ${String(err)}`)
      await this.send(`Error fetching jobs: ${String(err)}`)
    }
  }

  private async handleFeedback(text: string): Promise<void> {
    try {
      const id = randomUUID()
      await enqueue('ouro_feedback', { id, source: 'telegram', text, status: 'pending' })
      await this.send('Feedback queued. The meta-agent will process it.')
    } catch (err: unknown) {
      await log('gateway:telegram', `feedback error: ${String(err)}`)
      await this.send(`Error queuing feedback: ${String(err)}`)
    }
  }

  private async handleLogs(): Promise<void> {
    try {
      const db = getDb()
      const rows = await db<{ source: string; message: string; ts: Date }[]>`
        SELECT source, message, ts FROM ouro_logs
        ORDER BY ts DESC LIMIT 10
      `
      if (rows.length === 0) {
        await this.send('No logs found.')
        return
      }
      const lines = rows.reverse().map(r => `[${r.source}] ${r.message}`)
      await this.send(`Recent logs:\n${lines.join('\n')}`)
    } catch (err: unknown) {
      await log('gateway:telegram', `logs error: ${String(err)}`)
      await this.send(`Error fetching logs: ${String(err)}`)
    }
  }

  private async handleMcp(): Promise<void> {
    try {
      const db = getDb()
      const mcps = await db<{ name: string; status: string; tools_found: string[] | null }[]>`
        SELECT name, status, tools_found
        FROM ouro_mcp_registry
        ORDER BY registered_at DESC
      `
      if (mcps.length === 0) {
        await this.send('No MCPs registered.')
        return
      }
      const lines = mcps.map(m => {
        const tools = m.tools_found?.join(', ') ?? 'none'
        return `• [${m.status}] ${m.name} — tools: ${tools}`
      })
      await this.send(`Registered MCPs:\n${lines.join('\n')}`)
    } catch (err: unknown) {
      await log('gateway:telegram', `mcp error: ${String(err)}`)
      await this.send(`Error fetching MCPs: ${String(err)}`)
    }
  }
}
