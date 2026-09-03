import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'

const at = (p: string) => fileURLToPath(new URL(p, import.meta.url))

/**
 * A single-file build of the standalone app, for handing someone a link.
 * One bundle, no code splitting, so the whole thing inlines into one page.
 */
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@commission/engine': at('./packages/engine/src/index.ts'),
      '@commission/parsers': at('./packages/parsers/src/index.ts'),
      '@commission/cli': at('./packages/cli/src/reconcile.ts'),
    },
  },
  optimizeDeps: { entries: ['standalone.html'] },
  build: {
    outDir: 'dist-artifact',
    emptyOutDir: true,
    rollupOptions: {
      input: at('./standalone.html'),
      output: { inlineDynamicImports: true, entryFileNames: 'app.js', assetFileNames: 'app.[ext]' },
    },
  },
})
