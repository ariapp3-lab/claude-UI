import { defineConfig } from 'vite'
import { fileURLToPath } from 'node:url'

const at = (p: string) => fileURLToPath(new URL(p, import.meta.url))

/**
 * The SDK as one ESM file with no dependencies.
 *
 * A Supabase Edge Function, a Deno worker or a Cloudflare Worker can import it
 * directly; there is no package to install and nothing to resolve at runtime.
 */
export default defineConfig({
  resolve: {
    alias: {
      '@commission/engine': at('./packages/engine/src/index.ts'),
      '@commission/parsers': at('./packages/parsers/src/index.ts'),
      '@commission/cli': at('./packages/cli/src/reconcile.ts'),
    },
  },
  build: {
    outDir: 'dist-sdk',
    emptyOutDir: true,
    target: 'es2022',
    lib: {
      entry: at('./packages/sdk/src/index.ts'),
      formats: ['es'],
      fileName: () => 'commission-sdk.js',
    },
    rollupOptions: { external: [] },
  },
})
