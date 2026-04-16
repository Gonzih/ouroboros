import { getDb } from './db.js'

export async function log(source: string, message: string): Promise<void> {
  process.stdout.write(`[${source}] ${message}\n`)
  try {
    const db = getDb()
    await db`INSERT INTO ouro_logs (source, message) VALUES (${source}, ${message})`
  } catch {
    // swallow — log failures must never crash the caller
  }
}
