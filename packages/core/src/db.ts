import postgres from 'postgres'

let _db: postgres.Sql | null = null

export function getDb(): postgres.Sql {
  if (!_db) _db = postgres(process.env['DATABASE_URL']!)
  return _db
}

export async function closeDb(): Promise<void> {
  if (_db) {
    await _db.end()
    _db = null
  }
}
