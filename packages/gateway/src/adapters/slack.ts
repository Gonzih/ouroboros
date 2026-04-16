import https from 'node:https'
import http from 'node:http'
import { log } from '@ouroboros/core'
import type { ChannelAdapter } from './log.js'

export type { ChannelAdapter }

// Posts a message to Slack via the Web API chat.postMessage endpoint.
// Requires SLACK_BOT_TOKEN and SLACK_CHANNEL_ID.
export class SlackAdapter implements ChannelAdapter {
  readonly name = 'slack'
  private token: string
  private channelId: string

  constructor(token: string, channelId: string) {
    this.token = token
    this.channelId = channelId
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
    await log('gateway:slack', 'slack adapter started (outbound only)')
  }

  async stop(): Promise<void> {
    // nothing to tear down
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
