import { readdir, readFile } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { getDb } from './db.js'

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), 'migrations')

export async function migrate(): Promise<void> {
  const db = getDb()

  await db`
    CREATE TABLE IF NOT EXISTS ouro_migrations (
      name       TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `

  const applied = await db<{ name: string }[]>`SELECT name FROM ouro_migrations`
  const appliedSet = new Set(applied.map(r => r.name))

  const files = (await readdir(MIGRATIONS_DIR))
    .filter(f => f.endsWith('.sql'))
    .sort()

  for (const file of files) {
    if (appliedSet.has(file)) continue

    const sql = await readFile(join(MIGRATIONS_DIR, file), 'utf8')

    await db.begin(async tx => {
      await tx.unsafe(sql)
      await tx`INSERT INTO ouro_migrations (name) VALUES (${file})`
    })
  }
}
