<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useSchedulesStore } from '../stores/schedules'

const store = useSchedulesStore()

const showModal = ref(false)
const formName = ref('')
const formCron = ref('')
const formBackend = ref('git')
const formTarget = ref('')
const formInstructions = ref('')
const formError = ref<string | null>(null)
const formSubmitting = ref(false)
const togglingId = ref<string | null>(null)
const deletingId = ref<string | null>(null)

onMounted(() => { void store.fetchSchedules() })

function formatDate(d: string | null): string {
  if (!d) return '—'
  return new Date(d).toLocaleString()
}

async function submitCreate(): Promise<void> {
  if (!formName.value.trim() || !formCron.value.trim() || !formTarget.value.trim() || !formInstructions.value.trim()) return
  formError.value = null
  formSubmitting.value = true
  try {
    await store.createSchedule({
      name: formName.value.trim(),
      cron_expr: formCron.value.trim(),
      backend: formBackend.value.trim(),
      target: formTarget.value.trim(),
      instructions: formInstructions.value.trim(),
    })
    formName.value = ''
    formCron.value = ''
    formTarget.value = ''
    formInstructions.value = ''
    showModal.value = false
  } catch (err: unknown) {
    formError.value = String(err)
  } finally {
    formSubmitting.value = false
  }
}

async function toggle(id: string): Promise<void> {
  togglingId.value = id
  try {
    await store.toggleSchedule(id)
  } catch (err: unknown) {
    alert(String(err))
  } finally {
    togglingId.value = null
  }
}

async function remove(id: string, name: string): Promise<void> {
  if (!confirm(`Delete schedule "${name}"?`)) return
  deletingId.value = id
  try {
    await store.deleteSchedule(id)
  } catch (err: unknown) {
    alert(String(err))
  } finally {
    deletingId.value = null
  }
}
</script>

<template>
  <div>
    <div class="toolbar">
      <span class="section-title" style="margin-bottom:0">schedules</span>
      <div class="toolbar-actions">
        <button @click="store.fetchSchedules()">refresh</button>
        <button class="primary" @click="showModal = true">+ new schedule</button>
      </div>
    </div>

    <div v-if="store.loading" class="dim-text">loading...</div>
    <div v-else-if="store.error" class="error-text">{{ store.error }}</div>
    <div v-else-if="store.schedules.length === 0" class="dim-text">no schedules configured</div>
    <table v-else>
      <thead>
        <tr>
          <th>name</th>
          <th>cron</th>
          <th>backend</th>
          <th>last run</th>
          <th>next run</th>
          <th>enabled</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="s in store.schedules" :key="s.id">
          <td class="name-cell">{{ s.name }}</td>
          <td class="mono-cell">{{ s.cron_expr }}</td>
          <td class="dim-cell">{{ s.backend }}</td>
          <td class="dim-cell">{{ formatDate(s.last_run_at) }}</td>
          <td class="dim-cell">{{ formatDate(s.next_run_at) }}</td>
          <td>
            <button
              :class="s.enabled ? 'toggle-on' : 'toggle-off'"
              :disabled="togglingId === s.id"
              @click="toggle(s.id)"
            >
              {{ togglingId === s.id ? '…' : s.enabled ? 'on' : 'off' }}
            </button>
          </td>
          <td>
            <button
              class="danger-btn"
              :disabled="deletingId === s.id"
              @click="remove(s.id, s.name)"
            >
              delete
            </button>
          </td>
        </tr>
      </tbody>
    </table>

    <!-- Create modal -->
    <div v-if="showModal" class="modal-overlay" @click.self="showModal = false">
      <div class="modal card">
        <div class="section-title">new schedule</div>
        <div class="form-field">
          <label>name</label>
          <input v-model="formName" placeholder="daily-summary" class="full-width" />
        </div>
        <div class="form-field">
          <label>cron expression</label>
          <input v-model="formCron" placeholder="0 9 * * *" class="full-width" />
          <span class="field-hint">minute hour day month weekday</span>
        </div>
        <div class="form-field">
          <label>backend</label>
          <select v-model="formBackend" class="full-width">
            <option value="git">git</option>
            <option value="local">local</option>
          </select>
        </div>
        <div class="form-field">
          <label>target</label>
          <input v-model="formTarget" placeholder="https://github.com/owner/repo" class="full-width" />
        </div>
        <div class="form-field">
          <label>instructions</label>
          <textarea v-model="formInstructions" placeholder="Summarize new rows added today..." class="full-width" rows="3" />
        </div>
        <div v-if="formError" class="error-text">{{ formError }}</div>
        <div class="modal-actions">
          <button @click="showModal = false">cancel</button>
          <button
            class="primary"
            :disabled="formSubmitting || !formName.trim() || !formCron.trim() || !formTarget.trim() || !formInstructions.trim()"
            @click="submitCreate"
          >
            {{ formSubmitting ? 'creating...' : 'create' }}
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

.name-cell { font-weight: 500; }

.mono-cell {
  font-family: monospace;
  font-size: 12px;
}

.dim-cell {
  color: var(--dim);
  font-size: 11px;
}

.dim-text {
  color: var(--dim);
  font-size: 12px;
}

.toggle-on {
  border-color: var(--green);
  color: var(--green);
  font-size: 11px;
  padding: 2px 10px;
}

.toggle-off {
  border-color: var(--dim);
  color: var(--dim);
  font-size: 11px;
  padding: 2px 10px;
}

.toggle-on:hover {
  background: color-mix(in srgb, var(--green) 15%, transparent);
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
  width: 460px;
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

.field-hint {
  font-size: 10px;
  color: var(--dim);
  margin-top: 3px;
  display: block;
}

.full-width { width: 100%; }

.modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 16px;
}
</style>
