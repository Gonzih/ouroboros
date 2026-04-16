import { getDb } from './db.js'

export async function tryAcquireLock(key: string): Promise<boolean> {
  const db = getDb()
  const rows = await db<{ result: boolean }[]>`SELECT pg_try_advisory_lock(hashtext(${key})) AS result`
  return rows[0]?.result ?? false
}

export async function releaseLock(key: string): Promise<void> {
  const db = getDb()
  await db`SELECT pg_advisory_unlock(hashtext(${key}))`
}
