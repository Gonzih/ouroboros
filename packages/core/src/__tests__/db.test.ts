import { describe, it, expect, vi, afterEach } from 'vitest'

const { mockEnd, mockSqlInstance } = vi.hoisted(() => {
  const mockEnd = vi.fn().mockResolvedValue(undefined)
  const mockSqlInstance = Object.assign(vi.fn(), { end: mockEnd })
  return { mockEnd, mockSqlInstance }
})

vi.mock('postgres', () => ({
  default: vi.fn().mockReturnValue(mockSqlInstance)
}))

import postgres from 'postgres'
import { getDb, closeDb } from '../db.js'

describe('db', () => {
  afterEach(async () => {
    await closeDb()
    vi.clearAllMocks()
  })

  it('getDb() creates a connection with DATABASE_URL', () => {
    process.env['DATABASE_URL'] = 'postgres://user:pass@localhost/test'
    const db = getDb()
    expect(postgres).toHaveBeenCalledWith('postgres://user:pass@localhost/test')
    expect(db).toBe(mockSqlInstance)
  })

  it('getDb() returns the same instance on repeated calls (singleton)', () => {
    const db1 = getDb()
    const db2 = getDb()
    expect(db1).toBe(db2)
    expect(postgres).toHaveBeenCalledTimes(1)
  })

  it('closeDb() calls end() and resets the connection', async () => {
    getDb()
    await closeDb()
    expect(mockEnd).toHaveBeenCalled()
    // After closing, a fresh call creates a new connection
    vi.clearAllMocks()
    getDb()
    expect(postgres).toHaveBeenCalledTimes(1)
  })

  it('closeDb() is safe to call when no connection exists', async () => {
    // _db is null after afterEach's closeDb
    await expect(closeDb()).resolves.toBeUndefined()
    expect(mockEnd).not.toHaveBeenCalled()
  })
})
