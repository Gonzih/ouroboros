import postgres from 'postgres'
import { getDb } from './db.js'

export async function publish(channel: string, payload: unknown): Promise<void> {
  const db = getDb()
  await db`SELECT pg_notify(${channel}, ${JSON.stringify(payload)})`
}

export async function subscribe(
  channel: string,
  cb: (payload: unknown) => Promise<void>
): Promise<() => void> {
  let conn: postgres.Sql | null = null
  let closed = false

  async function connect(): Promise<void> {
    conn = postgres(process.env['DATABASE_URL']!, { max: 1 })

    // postgres.js surfaces LISTEN/NOTIFY via `.listen()`
    await conn.listen(channel, async (data: string) => {
      let parsed: unknown
      try {
        parsed = JSON.parse(data)
      } catch {
        parsed = data
      }
      try {
        await cb(parsed)
      } catch {
        // swallow callback errors — event bus must not crash on bad handlers
      }
    })

    // Reconnect on unexpected connection loss
    conn.unsafe('SELECT 1').catch(() => {
      if (!closed) {
        setTimeout(() => {
          if (!closed) connect().catch(() => undefined)
        }, 2000)
      }
    })
  }

  await connect()

  return async () => {
    closed = true
    if (conn) {
      await conn.end().catch(() => undefined)
      conn = null
    }
  }
}
