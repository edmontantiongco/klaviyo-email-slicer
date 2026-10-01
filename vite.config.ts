import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': path.resolve(import.meta.dirname, './src') },
  },
  // @jsquash ships WASM that must not be pre-bundled
  optimizeDeps: {
    exclude: ['@jsquash/jpeg', '@jsquash/png', '@jsquash/oxipng'],
  },
  worker: { format: 'es' },
  build: { chunkSizeWarningLimit: 1200 },
  server: {
    port: 5173,
    proxy: { '/api': 'http://localhost:8787' },
  },
})
