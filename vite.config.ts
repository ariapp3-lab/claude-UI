import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'

const at = (p: string) => fileURLToPath(new URL(p, import.meta.url))

export default defineConfig({
  plugins: [react()],

  resolve: {
    alias: {
      // The app imports the engine directly rather than a built artefact, so a
      // change to a contract rule is visible without a build step.
      '@commission/engine': at('./packages/engine/src/index.ts'),
      '@commission/parsers': at('./packages/parsers/src/index.ts'),
      '@commission/cli': at('./packages/cli/src/reconcile.ts'),
    },
  },

  // The repo also holds standalone HTML (the spec, the static portal preview).
  // Without this, Vite's dependency scan tries to parse them as app entries.
  optimizeDeps: { entries: ['index.html', 'standalone.html'] },

  build: {
    rollupOptions: {
      input: {
        // Two shells over one engine: embedded in the CRM, and standalone for
        // an agency that wants the reconciliation on its own.
        main: at('./index.html'),
        standalone: at('./standalone.html'),
      },
    },
  },
})
