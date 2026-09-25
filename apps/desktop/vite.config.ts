import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1', port: 1420, strictPort: true,
    fs: { allow: ['../..'] },
    watch: { ignored: ['**/src-tauri/**', '**/core/**', '**/artifacts/**'] },
  },
  test: {
    environment: 'jsdom',
    include: ['../../tests/frontend/**/*.test.{ts,tsx}'],
    setupFiles: ['../../tests/frontend/setup.ts'],
  },
})
