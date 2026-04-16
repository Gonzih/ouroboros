import https from 'node:https'
import http from 'node:http'
import { log } from '@ouroboros/core'
import type { ChannelAdapter } from './log.js'

export type { ChannelAdapter }

// Generic outbound webhook adapter. POSTs { message, timestamp } JSON to OURO_WEBHOOK_URL.
export class WebhookAdapter implements ChannelAdapter {
  readonly name = 'webhook'
  private webhookUrl: string

  constructor(webhookUrl: string) {
    this.webhookUrl = webhookUrl
  }

  async send(message: string): Promise<void> {
    const payload = JSON.stringify({ message, timestamp: new Date().toISOString() })
    try {
      await this.post(this.webhookUrl, payload, { 'Content-Type': 'application/json' })
    } catch (err: unknown) {
      await log('gateway:webhook', `send failed: ${String(err)}`)
    }
  }

  async start(): Promise<void> {
    await log('gateway:webhook', `webhook adapter started → ${this.webhookUrl}`)
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
          // Drain response to avoid socket hang
          res.resume()
          res.on('end', () => {
            const status = res.statusCode ?? 0
            if (status >= 200 && status < 300) {
              resolve()
            } else {
              reject(new Error(`webhook returned HTTP ${status}`))
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
