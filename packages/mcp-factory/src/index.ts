import { fileURLToPath } from 'node:url'
import { migrate, log } from '@ouroboros/core'
import { createServer } from './server.js'

export async function start(): Promise<void> {
  await migrate()
  const app = createServer()
  const port = parseInt(process.env['PORT_MCP_FACTORY'] ?? '7703', 10)
  app.listen(port, () => {
    void log('mcp-factory', `listening on port ${port}`)
  })
  void log('mcp-factory', 'started')
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  start().catch(console.error)
}
