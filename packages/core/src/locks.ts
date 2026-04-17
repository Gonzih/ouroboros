import postgres from 'postgres'
import { getDb } from './db.js'

// Advisory locks must be held on a single dedicated connection.
// Using a pooled connection risks silent lock release if the pool recycles it.
let _lockConn: postgres.ReservedSql | null = null

export async function tryAcquireLock(key: string): Promise<boolean> {
  const db = getDb()
  const conn = await db.reserve()
  const rows = await conn<{ result: boolean }[]>`SELECT pg_try_advisory_lock(hashtext(${key})) AS result`
  if (!rows[0]?.result) {
    conn.release()
    return false
  }
  // Keep the reserved connection alive — releasing it would drop the lock
  _lockConn = conn
  return true
}

export async function releaseLock(key: string): Promise<void> {
  if (_lockConn) {
    await _lockConn`SELECT pg_advisory_unlock(hashtext(${key}))`
    _lockConn.release()
    _lockConn = null
  }
}
