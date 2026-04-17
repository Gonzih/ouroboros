import https from 'node:https'
import http from 'node:http'
import crypto from 'node:crypto'
import { getDb, log, enqueue, publish } from '@ouroboros/core'
import type { ChannelAdapter } from './log.js'

export type { ChannelAdapter }

// Ed25519 SPKI DER header (12 bytes) that prefixes a raw 32-byte Ed25519 public key.
// Allows constructing a KeyObject from Discord's raw hex public key without external deps.
const ED25519_SPKI_HEADER = Buffer.from('302a300506032b6570032100', 'hex')

const DISCORD_COMMANDS = [
  { name: 'status', description: 'Show system status (jobs, active MCPs)' },
  { name: 'jobs', description: 'List the 5 most recent jobs' },
  { name: 'mcp', description: 'List registered MCP servers and their status' },
  { name: 'logs', description: 'Show the 10 most recent log lines' },
  {
    name: 'approve',
    description: 'Approve a pending evolution',
    options: [{ type: 3, name: 'id', description: 'Evolution ID', required: true }],
  },
  {
    name: 'reject',
    description: 'Reject a pending evolution',
    options: [{ type: 3, name: 'id', description: 'Evolution ID', required: true }],
  },
  {
    name: 'feedback',
    description: 'Submit feedback to the meta-agent',
    options: [{ type: 3, name: 'text', description: 'Feedback text', required: true }],
  },
  {
    name: 'task',
    description: 'Queue a new worker task',
    options: [
      { type: 3, name: 'instructions', description: 'Task instructions', required: true },
      { type: 3, name: 'backend', description: 'Storage backend (git, local, s3, gdrive, onedrive)', required: false },
      { type: 3, name: 'target', description: 'Target path or URL', required: false },
    ],
  },
]

// Posts messages to Discord via the channels API (requires DISCORD_BOT_TOKEN + DISCORD_CHANNEL_ID).
// When DISCORD_PUBLIC_KEY is provided, also handles inbound Interactions API events:
// /approve, /reject, /status, /jobs, /mcp slash commands (full parity with Telegram).
// When DISCORD_APPLICATION_ID is provided, slash commands are auto-registered on startup.
export class DiscordAdapter implements ChannelAdapter {
  readonly name = 'discord'
  private token: string
  private channelId: string
  private publicKey: string | null
  private applicationId: string | null

  constructor(token: string, channelId: string, publicKey?: string, applicationId?: string) {
    this.token = token
    this.channelId = channelId
    this.publicKey = publicKey ?? null
    this.applicationId = applicationId ?? null
  }

  async send(message: string): Promise<void> {
    const body = JSON.stringify({ content: message })
    try {
      await this.post(`https://discord.com/api/v10/channels/${this.channelId}/messages`, body, {
        'Authorization': `Bot ${this.token}`,
        'Content-Type': 'application/json',
      })
    } catch (err: unknown) {
      await log('gateway:discord', `send failed: ${String(err)}`)
    }
  }

  async start(): Promise<void> {
    const mode = this.publicKey ? 'inbound + outbound' : 'outbound only'
    await log('gateway:discord', `discord adapter started (${mode})`)
    if (this.applicationId) {
      await this.registerCommands().catch(async (err: unknown) => {
        await log('gateway:discord', `command registration failed: ${String(err)}`)
      })
    }
  }

  // Bulk-registers all slash commands with the Discord API.
  // Requires DISCORD_APPLICATION_ID. Uses PUT to replace the full command list atomically.
  async registerCommands(): Promise<void> {
    if (!this.applicationId) return
    const url = `https://discord.com/api/v10/applications/${this.applicationId}/commands`
    const body = JSON.stringify(DISCORD_COMMANDS)
    await this.put(url, body, {
      'Authorization': `Bot ${this.token}`,
      'Content-Type': 'application/json',
    })
    await log('gateway:discord', `registered ${DISCORD_COMMANDS.length} slash commands`)
  }

  async stop(): Promise<void> {
    // nothing to tear down — interactions endpoint is stateless HTTP
  }

  // Called by the HTTP server for POST /discord/interactions.
  // Returns a Discord interaction response object, or null on signature failure.
  async handleInteraction(
    rawBody: string,
    signature: string,
    timestamp: string,
  ): Promise<Record<string, unknown> | null> {
    if (!this.publicKey) return null

    // Ed25519 signature verification using Node.js built-in crypto.
    // Discord signs (timestamp + rawBody) with the bot's Ed25519 private key.
    try {
      const der = Buffer.concat([ED25519_SPKI_HEADER, Buffer.from(this.publicKey, 'hex')])
      const pubKeyObj = crypto.createPublicKey({ key: der, format: 'der', type: 'spki' })
      const isValid = crypto.verify(
        null,
        Buffer.from(timestamp + rawBody),
        pubKeyObj,
        Buffer.from(signature, 'hex'),
      )
      if (!isValid) return null
    } catch {
      return null
    }

    let payload: unknown
    try {
      payload = JSON.parse(rawBody)
    } catch {
      return null
    }
    if (typeof payload !== 'object' || payload === null) return null
    const p = payload as Record<string, unknown>

    // PING — Discord sends this to verify the interactions endpoint during setup
    if (p['type'] === 1) {
      return { type: 1 }
    }

    // APPLICATION_COMMAND (type 2) — route slash commands
    if (p['type'] === 2) {
      const data = p['data'] as Record<string, unknown> | undefined
      const commandName = typeof data?.['name'] === 'string' ? data['name'] : ''
      const options = Array.isArray(data?.['options']) ? (data['options'] as Array<Record<string, unknown>>) : []
      const firstOption = typeof options[0]?.['value'] === 'string' ? (options[0]['value'] as string) : ''

      if (commandName === 'approve' && firstOption) {
        const content = await this.handleApprove(firstOption)
        return { type: 4, data: { content } }
      }
      if (commandName === 'reject' && firstOption) {
        const content = await this.handleReject(firstOption)
        return { type: 4, data: { content } }
      }
      if (commandName === 'status') {
        const content = await this.handleStatus()
        return { type: 4, data: { content } }
      }
      if (commandName === 'jobs') {
        const content = await this.handleJobs()
        return { type: 4, data: { content } }
      }
      if (commandName === 'mcp') {
        const content = await this.handleMcp()
        return { type: 4, data: { content } }
      }
      if (commandName === 'logs') {
        const content = await this.handleLogs()
        return { type: 4, data: { content } }
      }
      if (commandName === 'feedback') {
        const content = await this.handleFeedback(firstOption)
        return { type: 4, data: { content } }
      }
      if (commandName === 'task') {
        // options: backend (optional), target (optional), instructions (required)
        const optMap = Object.fromEntries(
          (Array.isArray(data?.['options']) ? (data['options'] as Array<Record<string, unknown>>) : [])
            .map(o => [o['name'] as string, o['value'] as string])
        )
        const content = await this.handleTask(
          optMap['backend'] ?? '',
          optMap['target'] ?? '',
          optMap['instructions'] ?? firstOption,
        )
        return { type: 4, data: { content } }
      }
    }

    // Unknown interaction type — acknowledge with PONG to avoid Discord timeout errors
    return { type: 1 }
  }

  private async handleApprove(id: string): Promise<string> {
    try {
      const db = getDb()
      const result = await db`
        UPDATE ouro_feedback SET status = 'approved' WHERE id = ${id} RETURNING id
      `
      if (result.length === 0) return `No feedback found with id ${id}`
      await publish('ouro_notify', { type: 'evolution_approved', id })
      return `Evolution ${id} approved.`
    } catch (err: unknown) {
      await log('gateway:discord', `approve error: ${String(err)}`)
      return `Error approving ${id}: ${String(err)}`
    }
  }

  private async handleReject(id: string): Promise<string> {
    try {
      const db = getDb()
      const result = await db`
        UPDATE ouro_feedback SET status = 'rejected' WHERE id = ${id} RETURNING id
      `
      if (result.length === 0) return `No feedback found with id ${id}`
      await publish('ouro_notify', { type: 'evolution_rejected', id })
      return `Evolution ${id} rejected.`
    } catch (err: unknown) {
      await log('gateway:discord', `reject error: ${String(err)}`)
      return `Error rejecting ${id}: ${String(err)}`
    }
  }

  private async handleStatus(): Promise<string> {
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
      return (
        `Status:\n` +
        `Jobs — running: ${running}, pending: ${pending}, completed: ${completed}, failed: ${failed}\n` +
        `Active MCPs: ${mcpCount}`
      )
    } catch (err: unknown) {
      await log('gateway:discord', `status error: ${String(err)}`)
      return `Error fetching status: ${String(err)}`
    }
  }

  private async handleJobs(): Promise<string> {
    try {
      const db = getDb()
      const jobs = await db<{ id: string; description: string; status: string; created_at: Date }[]>`
        SELECT id, description, status, created_at
        FROM ouro_jobs
        ORDER BY created_at DESC
        LIMIT 5
      `
      if (jobs.length === 0) return 'No jobs found.'
      const lines = jobs.map(j => `• [${j.status}] ${j.id}: ${j.description}`)
      return `Last ${jobs.length} jobs:\n${lines.join('\n')}`
    } catch (err: unknown) {
      await log('gateway:discord', `jobs error: ${String(err)}`)
      return `Error fetching jobs: ${String(err)}`
    }
  }

  private async handleTask(backend: string, target: string, instructions: string): Promise<string> {
    if (!instructions) return 'Usage: /task instructions:<text> [backend:<type>] [target:<url>]'
    const knownBackends = ['git', 'local', 's3', 'gdrive', 'onedrive']
    const resolvedBackend = backend && knownBackends.includes(backend) ? backend : 'git'
    let resolvedTarget = target
    if (!resolvedTarget) {
      const repoRoot = process.env['OURO_REPO_ROOT']
      if (!repoRoot) return 'target is required or set OURO_REPO_ROOT as default'
      resolvedTarget = repoRoot
    }
    try {
      const db = getDb()
      const id = crypto.randomUUID()
      await db`
        INSERT INTO ouro_jobs (id, description, backend, target, status, instructions)
        VALUES (${id}, ${instructions}, ${resolvedBackend}, ${resolvedTarget}, 'pending', ${instructions})
      `
      await enqueue('ouro_tasks', { id, backend: resolvedBackend, target: resolvedTarget, instructions })
      return `Task queued: ${id}`
    } catch (err: unknown) {
      await log('gateway:discord', `task error: ${String(err)}`)
      return `Error queuing task: ${String(err)}`
    }
  }

  private async handleFeedback(text: string): Promise<string> {
    if (!text) return 'Usage: /feedback <text>'
    try {
      const id = crypto.randomUUID()
      await enqueue('ouro_feedback', { id, source: 'discord', text, status: 'pending' })
      return 'Feedback queued. The meta-agent will process it.'
    } catch (err: unknown) {
      await log('gateway:discord', `feedback error: ${String(err)}`)
      return `Error queuing feedback: ${String(err)}`
    }
  }

  private async handleLogs(): Promise<string> {
    try {
      const db = getDb()
      const rows = await db<{ source: string; message: string; ts: Date }[]>`
        SELECT source, message, ts FROM ouro_logs
        ORDER BY ts DESC LIMIT 10
      `
      if (rows.length === 0) return 'No logs found.'
      const lines = rows.reverse().map(r => `[${r.source}] ${r.message}`)
      return `Recent logs:\n${lines.join('\n')}`
    } catch (err: unknown) {
      await log('gateway:discord', `logs error: ${String(err)}`)
      return `Error fetching logs: ${String(err)}`
    }
  }

  private async handleMcp(): Promise<string> {
    try {
      const db = getDb()
      const mcps = await db<{ name: string; status: string; tools_found: string[] | null }[]>`
        SELECT name, status, tools_found
        FROM ouro_mcp_registry
        ORDER BY registered_at DESC
      `
      if (mcps.length === 0) return 'No MCPs registered.'
      const lines = mcps.map(m => {
        const tools = m.tools_found?.join(', ') ?? 'none'
        return `• [${m.status}] ${m.name} — tools: ${tools}`
      })
      return `Registered MCPs:\n${lines.join('\n')}`
    } catch (err: unknown) {
      await log('gateway:discord', `mcp error: ${String(err)}`)
      return `Error fetching MCPs: ${String(err)}`
    }
  }

  private request(method: string, url: string, body: string, headers: Record<string, string>): Promise<void> {
    return new Promise((resolve, reject) => {
      const urlObj = new URL(url)
      const lib: typeof https | typeof http = urlObj.protocol === 'https:' ? https : http

      const req = lib.request(
        {
          hostname: urlObj.hostname,
          port: urlObj.port !== '' ? urlObj.port : undefined,
          path: urlObj.pathname + urlObj.search,
          method,
          headers: {
            ...headers,
            'Content-Length': Buffer.byteLength(body),
          },
        },
        (res) => {
          const chunks: Buffer[] = []
          res.on('data', (chunk: Buffer) => chunks.push(chunk))
          res.on('end', () => {
            if ((res.statusCode ?? 0) >= 400) {
              reject(new Error(`Discord API error: ${res.statusCode} ${Buffer.concat(chunks).toString()}`))
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

  private post(url: string, body: string, headers: Record<string, string>): Promise<void> {
    return this.request('POST', url, body, headers)
  }

  private put(url: string, body: string, headers: Record<string, string>): Promise<void> {
    return this.request('PUT', url, body, headers)
  }
}
