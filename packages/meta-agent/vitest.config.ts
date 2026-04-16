import { defineConfig } from 'vitest/config'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = fileURLToPath(new URL('.', import.meta.url))

export default defineConfig({
  resolve: {
    alias: {
      '@ouroboros/core': resolve(__dirname, '../core/src/index.ts'),
    }
  },
  test: {
    environment: 'node',
    // Only run tests in __tests__/ — exclude the old node:test file in src/test/
    include: ['src/__tests__/**/*.{test,spec}.{ts,js}'],
    coverage: { provider: 'v8', reporter: ['text', 'json'] }
  }
})
