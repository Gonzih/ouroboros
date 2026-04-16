import { fileURLToPath } from 'node:url'
import { server, broadcast } from './app.js'
import { subscribe, log } from '@ouroboros/core'

const PORT = parseInt(process.env['PORT_UI'] ?? '7702', 10)

export async function start(): Promise<void> {
  const unsub = await subscribe('ouro_notify', async (payload: unknown) => {
    broadcast({ type: 'notify', payload })
  })

  await new Promise<void>((resolve) => {
    server.listen(PORT, () => {
      void log('ui', `UI server listening on port ${PORT}`)
      resolve()
    })
  })

  const shutdown = async (): Promise<void> => {
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
