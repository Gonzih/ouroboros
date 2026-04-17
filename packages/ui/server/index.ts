import { fileURLToPath } from 'node:url'
import { server, broadcast, mountRoutes } from './app.js'
import { subscribe, log, registerProcess, unregisterProcess, heartbeat } from '@ouroboros/core'

const PORT = parseInt(process.env['PORT_UI'] ?? '7702', 10)

export async function start(): Promise<void> {
  // Mount OIDC middleware + API routes before server starts accepting connections
  await mountRoutes()

  const unsub = await subscribe('ouro_notify', async (payload: unknown) => {
    broadcast({ type: 'notify', payload })
  })

  await new Promise<void>((resolve) => {
    server.listen(PORT, () => {
      void log('ui', `UI server listening on port ${PORT}`)
      resolve()
    })
  })

  await registerProcess('ui', process.pid, 'node', process.argv.slice(1))
  const heartbeatInterval = setInterval(() => { void heartbeat('ui') }, 30_000)

  const shutdown = async (): Promise<void> => {
    clearInterval(heartbeatInterval)
    await unregisterProcess('ui')
    await unsub()
    server.close()
    process.exit(0)
  }

  process.on('SIGTERM', () => { void shutdown() })
  process.on('SIGINT', () => { void shutdown() })

  await new Promise<never>(() => undefined)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await start()
}
