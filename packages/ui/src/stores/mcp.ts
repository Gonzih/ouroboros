import { ref } from 'vue'
import { defineStore } from 'pinia'

export interface McpRow {
  name: string
  connection_string: string
  status: string
  validation_log: string | null
  tools_found: string[] | null
  registered_at: string
  validated_at: string | null
}

export const useMcpStore = defineStore('mcp', () => {
  const mcps = ref<McpRow[]>([])
  const loading = ref(false)
  const error = ref<string | null>(null)

  async function fetchMcp(): Promise<void> {
    loading.value = true
    error.value = null
    try {
      const res = await fetch('/api/mcp')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      mcps.value = (await res.json()) as McpRow[]
    } catch (err: unknown) {
      error.value = String(err)
    } finally {
      loading.value = false
    }
  }

  async function registerMcp(name: string, connectionString: string): Promise<void> {
    const res = await fetch('/api/mcp/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, connectionString })
    })
    if (!res.ok) {
      const data = (await res.json()) as { error?: string }
      throw new Error(data.error ?? 'Failed to register MCP')
    }
    await fetchMcp()
  }

  async function deleteMcp(name: string): Promise<void> {
    const res = await fetch(`/api/mcp/${encodeURIComponent(name)}`, { method: 'DELETE' })
    if (!res.ok) {
      const data = (await res.json()) as { error?: string }
      throw new Error(data.error ?? 'Failed to delete MCP')
    }
    await fetchMcp()
  }

  return { mcps, loading, error, fetchMcp, registerMcp, deleteMcp }
})
