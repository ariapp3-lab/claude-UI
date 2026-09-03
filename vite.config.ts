import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@commission/engine': fileURLToPath(
        new URL('./packages/engine/src/index.ts', import.meta.url),
      ),
      '@commission/parsers': fileURLToPath(
        new URL('./packages/parsers/src/index.ts', import.meta.url),
      ),
      '@commission/cli': fileURLToPath(
        new URL('./packages/cli/src/reconcile.ts', import.meta.url),
      ),
    },
  },
})
