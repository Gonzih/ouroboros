import https from 'node:https'
import http from 'node:http'
import crypto from 'node:crypto'
import { randomUUID } from 'node:crypto'
import { getDb, log, enqueue, publish } from '@ouroboros/core'
import type { ChannelAdapter } from './log.js'

export type { ChannelAdapter }

// Posts messages to Slack via chat.postMessage (requires SLACK_BOT_TOKEN + SLACK_CHANNEL_ID).
// When SLACK_SIGNING_SECRET is provided, also handles inbound Events API events so that
// /approve and /reject commands can be issued from Slack (same parity as Telegram).
export class SlackAdapter implements ChannelAdapter {
  readonly name = 'slack'
  private token: string
  private channelId: string
  private signingSecret: string | null

  constructor(token: string, channelId: string, signingSecret?: string) {
    this.token = token
    this.channelId = channelId
    this.signingSecret = signingSecret ?? null
  }

  async send(message: string): Promise<void> {
    const body = JSON.stringify({ channel: this.channelId, text: message })
    try {
      await this.post('https://slack.com/api/chat.postMessage', body, {
        'Authorization': `Bearer ${this.token}`,
        'Content-Type': 'application/json',
      })
    } catch (err: unknown) {
      await log('gateway:slack', `send failed: ${String(err)}`)
    }
  }

  async start(): Promise<void> {
    const mode = this.signingSecret ? 'inbound + outbound' : 'outbound only'
    await log('gateway:slack', `slack adapter started (${mode})`)
  }

  async stop(): Promise<void> {
    // nothing to tear down
  }

  // Called by the HTTP server for POST /slack/events.
  // Returns { challenge } for URL verification, {} for handled events, null on auth failure.
  async handleEvent(
    rawBody: string,
    timestamp: string,
    signature: string,
  ): Promise<{ challenge?: string } | null> {
    if (!this.signingSecret) return null

    // Replay protection: reject requests older than 5 minutes
    if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return null

    // HMAC-SHA256 signature verification
    const baseString = `v0:${timestamp}:${rawBody}`
    const expected = 'v0=' + crypto.createHmac('sha256', this.signingSecret).update(baseString).digest('hex')
    const sigBuffer = Buffer.from(signature)
    const expBuffer = Buffer.from(expected)
    if (sigBuffer.length !== expBuffer.length) return null
    if (!crypto.timingSafeEqual(sigBuffer, expBuffer)) return null

    let payload: unknown
    try {
      payload = JSON.parse(rawBody)
    } catch {
      return null
    }
    if (typeof payload !== 'object' || payload === null) return null
    const p = payload as Record<string, unknown>

    // URL verification challenge (sent by Slack when first configuring the endpoint)
    if (p['type'] === 'url_verification') {
      return { challenge: String(p['challenge'] ?? '') }
    }

    // Message events: route /approve and /reject commands
    if (p['type'] === 'event_callback') {
      const event = p['event']
      if (typeof event === 'object' && event !== null) {
        const ev = event as Record<string, unknown>
        // Skip bot messages and other subtypes — only handle direct user messages
        if (ev['type'] === 'message' && !ev['subtype']) {
          const text = String(ev['text'] ?? '').trim()
          await this.handleCommand(text)
        }
      }
    }

    return {}
  }

  private async handleCommand(text: string): Promise<void> {
    if (text.startsWith('/approve ')) {
      const id = text.slice('/approve '.length).trim()
      if (id) await this.handleApprove(id)
    } else if (text.startsWith('/reject ')) {
      const id = text.slice('/reject '.length).trim()
      if (id) await this.handleReject(id)
    } else if (text === '/status') {
      await this.handleStatus()
    } else if (text === '/jobs') {
      await this.handleJobs()
    } else if (text === '/mcp') {
      await this.handleMcp()
    } else if (text === '/logs') {
      await this.handleLogs()
    } else if (text.startsWith('/feedback ')) {
      const feedbackText = text.slice('/feedback '.length).trim()
      if (feedbackText) await this.handleFeedback(feedbackText)
    } else if (text.startsWith('/task ')) {
      await this.handleTask(text.slice('/task '.length).trim())
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
      await log('gateway:slack', `status error: ${String(err)}`)
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
      await log('gateway:slack', `jobs error: ${String(err)}`)
      await this.send(`Error fetching jobs: ${String(err)}`)
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
      await log('gateway:slack', `mcp error: ${String(err)}`)
      await this.send(`Error fetching MCPs: ${String(err)}`)
    }
  }

  private async handleTask(args: string): Promise<void> {
    const parts = args.split(/\s+/)
    const knownBackends = ['git', 'local', 's3', 'gdrive', 'onedrive']
    let backend: string, target: string, instructions: string
    if (parts.length >= 3 && knownBackends.includes(parts[0] ?? '')) {
      backend = parts[0]!
      target = parts[1]!
      instructions = parts.slice(2).join(' ')
    } else {
      const repoRoot = process.env['OURO_REPO_ROOT']
      if (!repoRoot) {
        await this.send('Usage: /task <backend> <target> <instructions>\nOr set OURO_REPO_ROOT for short form: /task <instructions>')
        return
      }
      backend = 'git'
      target = repoRoot
      instructions = args
    }
    try {
      const db = getDb()
      const id = randomUUID()
      await db`
        INSERT INTO ouro_jobs (id, description, backend, target, status, instructions)
        VALUES (${id}, ${instructions}, ${backend}, ${target}, 'pending', ${instructions})
      `
      await enqueue('ouro_tasks', { id, backend, target, instructions })
      await this.send(`Task queued: ${id}`)
    } catch (err: unknown) {
      await log('gateway:slack', `task error: ${String(err)}`)
      await this.send(`Error queuing task: ${String(err)}`)
    }
  }

  private async handleFeedback(text: string): Promise<void> {
    try {
      const id = randomUUID()
      await enqueue('ouro_feedback', { id, source: 'slack', text, status: 'pending' })
      await this.send('Feedback queued. The meta-agent will process it.')
    } catch (err: unknown) {
      await log('gateway:slack', `feedback error: ${String(err)}`)
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
      await log('gateway:slack', `logs error: ${String(err)}`)
      await this.send(`Error fetching logs: ${String(err)}`)
    }
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
        await publish('ouro_notify', { type: 'evolution_approved', id })
        await this.send(`Evolution ${id} approved.`)
      }
    } catch (err: unknown) {
      await log('gateway:slack', `approve error: ${String(err)}`)
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
        await publish('ouro_notify', { type: 'evolution_rejected', id })
        await this.send(`Evolution ${id} rejected.`)
      }
    } catch (err: unknown) {
      await log('gateway:slack', `reject error: ${String(err)}`)
      await this.send(`Error rejecting ${id}: ${String(err)}`)
    }
  }

  private post(url: string, body: string, headers: Record<string, string>): Promise<void> {
    return new Promise((resolve, reject) => {
      const urlObj = new URL(url)
      const lib: typeof https | typeof http = urlObj.protocol === 'https:' ? https : http

      const req = lib.request(
        {
          hostname: urlObj.hostname,
          port: urlObj.port !== '' ? urlObj.port : undefined,
          path: urlObj.pathname + urlObj.search,
          method: 'POST',
          headers: {
            ...headers,
            'Content-Length': Buffer.byteLength(body),
          },
        },
        (res) => {
          const chunks: Buffer[] = []
          res.on('data', (chunk: Buffer) => chunks.push(chunk))
          res.on('end', () => {
            const raw = Buffer.concat(chunks).toString()
            let parsed: unknown
            try {
              parsed = JSON.parse(raw)
            } catch {
              parsed = raw
            }
            const ok = typeof parsed === 'object' && parsed !== null && (parsed as Record<string, unknown>)['ok']
            if (!ok) {
              reject(new Error(`Slack API error: ${raw}`))
            } else {
              resolve()
            }
          })
          res.on('error', reject)
        }
      )

      req.on('error', reject)
      req.write(body)
      req.end()
    })
  }
}
