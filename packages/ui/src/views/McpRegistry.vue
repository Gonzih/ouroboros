<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useMcpStore } from '../stores/mcp'
import StatusBadge from '../components/StatusBadge.vue'

const mcpStore = useMcpStore()

const showModal = ref(false)
const modalName = ref('')
const modalConnStr = ref('')
const modalError = ref<string | null>(null)
const modalSubmitting = ref(false)

onMounted(() => { void mcpStore.fetchMcp() })

function maskConnStr(s: string): string {
  try {
    const url = new URL(s)
    if (url.password) url.password = '***'
    return url.toString()
  } catch {
    return s.slice(0, 20) + '...'
  }
}

async function submitRegister(): Promise<void> {
  if (!modalName.value.trim() || !modalConnStr.value.trim()) return
  modalError.value = null
  modalSubmitting.value = true
  try {
    await mcpStore.registerMcp(modalName.value.trim(), modalConnStr.value.trim())
    modalName.value = ''
    modalConnStr.value = ''
    showModal.value = false
  } catch (err: unknown) {
    modalError.value = String(err)
  } finally {
    modalSubmitting.value = false
  }
}

async function deleteEntry(name: string): Promise<void> {
  if (!confirm(`Delete MCP "${name}"?`)) return
  try {
    await mcpStore.deleteMcp(name)
  } catch (err: unknown) {
    alert(String(err))
  }
}
</script>

<template>
  <div>
    <div class="toolbar">
      <span class="section-title" style="margin-bottom:0">mcp registry</span>
      <div class="toolbar-actions">
        <button @click="mcpStore.fetchMcp()">refresh</button>
        <button class="primary" @click="showModal = true">+ register</button>
      </div>
    </div>

    <div v-if="mcpStore.loading" class="dim-text">loading...</div>
    <div v-else-if="mcpStore.error" class="error-text">{{ mcpStore.error }}</div>
    <div v-else-if="mcpStore.mcps.length === 0" class="dim-text">no MCPs registered</div>
    <table v-else>
      <thead>
        <tr>
          <th>name</th>
          <th>connection</th>
          <th>status</th>
          <th>tools</th>
          <th>registered</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="mcp in mcpStore.mcps" :key="mcp.name">
          <td class="name-cell">{{ mcp.name }}</td>
          <td class="conn-cell">{{ maskConnStr(mcp.connection_string) }}</td>
          <td><StatusBadge :status="mcp.status" /></td>
          <td class="dim-cell">
            {{ mcp.tools_found ? mcp.tools_found.length + ' tools' : '—' }}
          </td>
          <td class="dim-cell">{{ new Date(mcp.registered_at).toLocaleString() }}</td>
          <td>
            <button class="danger-btn" @click="deleteEntry(mcp.name)">delete</button>
          </td>
        </tr>
      </tbody>
    </table>

    <!-- Register modal -->
    <div v-if="showModal" class="modal-overlay" @click.self="showModal = false">
      <div class="modal card">
        <div class="section-title">register mcp</div>
        <div class="form-field">
          <label>name</label>
          <input v-model="modalName" placeholder="my-db" class="full-width" />
        </div>
        <div class="form-field">
          <label>connection string</label>
          <input v-model="modalConnStr" placeholder="postgres://..." class="full-width" type="password" />
        </div>
        <div v-if="modalError" class="error-text">{{ modalError }}</div>
        <div class="modal-actions">
          <button @click="showModal = false">cancel</button>
          <button
            class="primary"
            :disabled="modalSubmitting || !modalName.trim() || !modalConnStr.trim()"
            @click="submitRegister"
          >
            {{ modalSubmitting ? 'registering...' : 'register' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 14px;
}

.toolbar-actions {
  display: flex;
  gap: 8px;
}

.name-cell {
  font-weight: 500;
}

.conn-cell {
  color: var(--dim);
  font-size: 11px;
  max-width: 240px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dim-cell {
  color: var(--dim);
  font-size: 11px;
}

.dim-text {
  color: var(--dim);
  font-size: 12px;
}

.danger-btn {
  border-color: var(--red);
  color: var(--red);
  font-size: 11px;
  padding: 2px 8px;
}

.danger-btn:hover {
  background: color-mix(in srgb, var(--red) 15%, transparent);
}

.primary {
  border-color: var(--accent);
  color: var(--accent);
}

.primary:hover {
  background: color-mix(in srgb, var(--accent) 15%, transparent);
}

.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
}

.modal {
  width: 420px;
  max-width: 90vw;
}

.form-field {
  margin-bottom: 12px;
}

.form-field label {
  display: block;
  font-size: 11px;
  color: var(--dim);
  margin-bottom: 4px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.full-width {
  width: 100%;
}

.modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 16px;
}
</style>
