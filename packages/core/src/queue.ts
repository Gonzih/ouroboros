import { getDb } from './db.js'

export async function enqueue(queue: string, message: unknown): Promise<bigint> {
  const db = getDb()
  const rows = await db<{ msg_id: string }[]>`SELECT pgmq.send(${queue}, ${JSON.stringify(message)}::jsonb) AS msg_id`
  const row = rows[0]
  if (!row) throw new Error(`pgmq.send returned no rows for queue ${queue}`)
  return BigInt(row.msg_id)
}

export async function dequeue<T>(
  queue: string,
  visibilityTimeoutSecs = 60
): Promise<{ msgId: bigint; message: T } | null> {
  const db = getDb()
  const rows = await db<{ msg_id: string; message: unknown }[]>`
    SELECT msg_id, message FROM pgmq.read(${queue}, ${visibilityTimeoutSecs}, 1)
  `
  const row = rows[0]
  if (!row) return null
  return { msgId: BigInt(row.msg_id), message: row.message as T }
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
