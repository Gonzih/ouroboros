#!/usr/bin/env node
import { migrate } from '@ouroboros/core'
import { startServer } from './server.js'

async function main(): Promise<void> {
  await migrate()
  await startServer()
  // stdio transport — process stays alive waiting for MCP messages
}

main().catch(console.error)
