<script setup lang="ts">
defineProps<{ status: string }>()

const colorMap: Record<string, string> = {
  pending: 'var(--dim)',
  running: 'var(--yellow)',
  completed: 'var(--green)',
  failed: 'var(--red)',
  cancelled: 'var(--dim)',
  operational: 'var(--green)',
  partial: 'var(--yellow)',
  pr_open: 'var(--yellow)',
  approved: 'var(--green)',
  rejected: 'var(--red)',
  applied: 'var(--blue)',
}

function color(status: string): string {
  return colorMap[status] ?? 'var(--dim)'
}
</script>

<template>
  <span class="badge" :style="{ color: color(status), borderColor: color(status) }">
    {{ status }}
  </span>
</template>

<style scoped>
.badge {
  display: inline-block;
  padding: 1px 6px;
  border: 1px solid;
  border-radius: 3px;
  font-size: 11px;
  font-weight: 500;
  letter-spacing: 0.03em;
}
</style>
