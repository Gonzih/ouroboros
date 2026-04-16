import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  build: {
    outDir: 'dist/client'
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: `http://localhost:${process.env['PORT_UI'] ?? '7702'}`,
        changeOrigin: true
      },
      '/ws': {
        target: `ws://localhost:${process.env['PORT_UI'] ?? '7702'}`,
        ws: true
      }
    }
  }
})
