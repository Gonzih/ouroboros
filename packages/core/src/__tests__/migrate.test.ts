import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('node:fs/promises', () => ({
  readdir: vi.fn(),
  readFile: vi.fn(),
}))

const { mockTx, mockBegin, mockDb } = vi.hoisted(() => {
  const mockTx = Object.assign(vi.fn().mockResolvedValue(undefined), {
    unsafe: vi.fn().mockResolvedValue(undefined),
  })
  const mockBegin = vi.fn()
  const mockDb = Object.assign(vi.fn(), { begin: mockBegin })
  return { mockTx, mockBegin, mockDb }
})

vi.mock('../db.js', () => ({
  getDb: () => mockDb
}))

import { readdir, readFile } from 'node:fs/promises'
import { migrate } from '../migrate.js'

const mockReaddir = vi.mocked(readdir)
const mockReadFile = vi.mocked(readFile)

describe('migrate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockBegin.mockImplementation(async (fn: (tx: typeof mockTx) => Promise<void>) => {
      await fn(mockTx)
    })
  })

  it('creates the migrations table on first run', async () => {
    mockDb.mockResolvedValueOnce(undefined)  // CREATE TABLE
    mockDb.mockResolvedValueOnce([])          // SELECT applied → none
    mockReaddir.mockResolvedValue([])

    await migrate()

    expect(mockDb).toHaveBeenCalledTimes(2)
    expect(mockBegin).not.toHaveBeenCalled()
  })

  it('skips already applied migrations', async () => {
    mockDb.mockResolvedValueOnce(undefined)
    mockDb.mockResolvedValueOnce([{ name: '001_init.sql' }])
    mockReaddir.mockResolvedValue(['001_init.sql'] as unknown as Awaited<ReturnType<typeof readdir>>)

    await migrate()

    expect(mockBegin).not.toHaveBeenCalled()
  })

  it('applies pending migration files in sorted order', async () => {
    mockDb.mockResolvedValueOnce(undefined)
    mockDb.mockResolvedValueOnce([{ name: '001_init.sql' }])
    mockReaddir.mockResolvedValue(
      ['002_jobs.sql', '001_init.sql'] as unknown as Awaited<ReturnType<typeof readdir>>
    )
    mockReadFile.mockResolvedValue('CREATE TABLE ouro_jobs (id SERIAL);' as never)

    await migrate()

    expect(mockBegin).toHaveBeenCalledTimes(1)
    expect(mockTx.unsafe).toHaveBeenCalledWith('CREATE TABLE ouro_jobs (id SERIAL);')
  })

  it('filters out non-sql files from the migration directory', async () => {
    mockDb.mockResolvedValueOnce(undefined)
    mockDb.mockResolvedValueOnce([])
    mockReaddir.mockResolvedValue(
      ['001_init.sql', 'README.md', '.gitkeep'] as unknown as Awaited<ReturnType<typeof readdir>>
    )
    mockReadFile.mockResolvedValue('CREATE TABLE test (id SERIAL);' as never)

    await migrate()

    expect(mockBegin).toHaveBeenCalledTimes(1)
  })

  it('records the applied migration name inside the transaction', async () => {
    mockDb.mockResolvedValueOnce(undefined)
    mockDb.mockResolvedValueOnce([])
    mockReaddir.mockResolvedValue(['001_init.sql'] as unknown as Awaited<ReturnType<typeof readdir>>)
    mockReadFile.mockResolvedValue('CREATE TABLE foo (id SERIAL);' as never)

    await migrate()

    expect(mockTx.unsafe).toHaveBeenCalledWith('CREATE TABLE foo (id SERIAL);')
    expect(mockTx).toHaveBeenCalled()  // tagged-template INSERT INTO ouro_migrations
  })
})
