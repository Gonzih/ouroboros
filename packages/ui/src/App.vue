<script setup lang="ts">
import { useWebSocket } from './composables/useWebSocket'

useWebSocket()
</script>

<template>
  <div class="app">
    <header class="nav">
      <span class="nav-brand">⬡ ouroboros</span>
      <nav class="nav-links">
        <RouterLink to="/">dashboard</RouterLink>
        <RouterLink to="/jobs">jobs</RouterLink>
        <RouterLink to="/logs">logs</RouterLink>
        <RouterLink to="/feedback">feedback</RouterLink>
        <RouterLink to="/mcp">mcp registry</RouterLink>
      </nav>
    </header>
    <main class="content">
      <RouterView />
    </main>
  </div>
</template>

<style>
/* ---- Design system ---- */
:root {
  --bg: #0d0d0d;
  --surface: #1a1a1a;
  --border: #2a2a2a;
  --text: #e0e0e0;
  --dim: #666;
  --green: #4caf50;
  --yellow: #ffc107;
  --red: #f44336;
  --blue: #2196f3;
  --accent: #7c3aed;
  --font: 'JetBrains Mono', 'Fira Code', 'Courier New', monospace;
}

*, *::before, *::after {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

html, body {
  background: var(--bg);
  color: var(--text);
  font-family: var(--font);
  font-size: 13px;
  height: 100%;
}

#app {
  height: 100%;
}

a {
  color: var(--accent);
  text-decoration: none;
}

a:hover {
  text-decoration: underline;
}

button {
  font-family: var(--font);
  font-size: 12px;
  cursor: pointer;
  border: 1px solid var(--border);
  background: var(--surface);
  color: var(--text);
  padding: 4px 10px;
  border-radius: 3px;
  transition: border-color 0.15s;
}

button:hover {
  border-color: var(--accent);
}

button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

input, textarea, select {
  font-family: var(--font);
  font-size: 12px;
  background: var(--surface);
  color: var(--text);
  border: 1px solid var(--border);
  border-radius: 3px;
  padding: 5px 8px;
  outline: none;
}

input:focus, textarea:focus, select:focus {
  border-color: var(--accent);
}

table {
  width: 100%;
  border-collapse: collapse;
}

th, td {
  padding: 6px 10px;
  text-align: left;
  border-bottom: 1px solid var(--border);
}

th {
  color: var(--dim);
  font-weight: 500;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

tr:hover td {
  background: var(--surface);
}

.card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 16px;
}

.section-title {
  color: var(--dim);
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  margin-bottom: 12px;
}

.error-text {
  color: var(--red);
  font-size: 12px;
}
</style>

<style scoped>
.app {
  display: flex;
  flex-direction: column;
  min-height: 100vh;
}

.nav {
  display: flex;
  align-items: center;
  gap: 24px;
  padding: 0 20px;
  height: 44px;
  border-bottom: 1px solid var(--border);
  background: var(--surface);
  position: sticky;
  top: 0;
  z-index: 10;
}

.nav-brand {
  color: var(--accent);
  font-weight: 700;
  font-size: 14px;
  white-space: nowrap;
}

.nav-links {
  display: flex;
  gap: 4px;
}

.nav-links a {
  padding: 4px 10px;
  border-radius: 3px;
  color: var(--dim);
  font-size: 12px;
  transition: color 0.15s, background 0.15s;
}

.nav-links a:hover {
  color: var(--text);
  text-decoration: none;
}

.nav-links a.router-link-active {
  color: var(--text);
  background: var(--bg);
}

.content {
  flex: 1;
  padding: 20px;
}
</style>
