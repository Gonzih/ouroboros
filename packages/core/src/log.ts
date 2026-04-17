import { getDb } from './db.js'
import { publish } from './events.js'

export async function log(source: string, message: string): Promise<void> {
  process.stdout.write(`[${source}] ${message}\n`)
  try {
    const db = getDb()
    const rows = await db<{ id: number; ts: string }[]>`
      INSERT INTO ouro_logs (source, message) VALUES (${source}, ${message})
      RETURNING id, ts
    `
    const row = rows[0]
    if (row) {
      await publish('ouro_notify', { type: 'log_entry', id: row.id, source, message, ts: row.ts })
    }
  } catch {
    // swallow — log failures must never crash the caller
  }
}
