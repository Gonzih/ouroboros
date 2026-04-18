import { getDb } from './db.js'

export async function enqueue(queue: string, message: unknown): Promise<bigint> {
  const db = getDb()
  // Use db.json() so postgres.js serialises the value with the jsonb OID directly
  // rather than sending a plain-text string and relying on a ::jsonb cast, which
  // can cause double-encoding when the connection pool's type registry is warm.
  const rows = await db<{ msg_id: string }[]>`SELECT pgmq.send(${queue}, ${db.json(message as Parameters<typeof db.json>[0])}) AS msg_id`
  const row = rows[0]
  if (!row) throw new Error(`pgmq.send returned no rows for queue ${queue}`)
  return BigInt(row.msg_id)
}

export async function dequeue<T>(
  queue: string,
  visibilityTimeoutSecs = 60
): Promise<{ msgId: bigint; message: T; readCt: number } | null> {
  const db = getDb()
  const rows = await db<{ msg_id: string; message: unknown; read_ct: number }[]>`
    SELECT msg_id, message, read_ct FROM pgmq.read(${queue}, ${visibilityTimeoutSecs}, 1)
  `
  const row = rows[0]
  if (!row) return null
  // postgres.js may return JSONB from set-returning functions as a raw string rather than
  // a parsed object. Unwrap up to two levels so consumers always receive a JS object,
  // regardless of whether the value was single- or double-encoded during storage.
  let parsed: unknown = row.message
  if (typeof parsed === 'string') parsed = JSON.parse(parsed)
  if (typeof parsed === 'string') parsed = JSON.parse(parsed)
  return { msgId: BigInt(row.msg_id), message: parsed as T, readCt: row.read_ct }
}

export async function ack(queue: string, msgId: bigint): Promise<void> {
  const db = getDb()
  await db`SELECT pgmq.delete(${queue}, ${msgId.toString()}::bigint)`
}

export async function nack(queue: string, msgId: bigint): Promise<void> {
  const db = getDb()
  // set_vt with 0 seconds makes the message immediately visible again
  await db`SELECT pgmq.set_vt(${queue}, ${msgId.toString()}::bigint, 0)`
}
