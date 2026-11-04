/// <reference types="vitest/config" />
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const monacoEsm = fileURLToPath(
  new URL('./node_modules/monaco-editor/esm/vs', import.meta.url),
);

// The app is a static site (client-only, local-first). The dev server must accept
// the Arena preview origin, so no host/origin allowlist is applied.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // Monaco's exports map forces ".js" onto every subpath, so its CSS cannot be
      // imported by bare specifier. Aliased here instead.
      'monaco-codicon-css': `${monacoEsm}/base/browser/ui/codicons/codicon/codicon.css`,
      'monaco-codicon-modifiers-css': `${monacoEsm}/base/browser/ui/codicons/codicon/codicon-modifiers.css`,
    },
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
    // The app is served through a proxied preview origin whose hostname is not
    // known ahead of time, so no host allowlist is applied.
    allowedHosts: true,
  },
  preview: {
    host: '0.0.0.0',
    port: 4173,
    strictPort: true,
    allowedHosts: true,
  },
  // Workers must be ES modules: the Luau wasm bindings and our worker entry both
  // use top-level await, which IIFE output (Vite's worker default) rejects.
  worker: {
    format: 'es',
  },
  // Lets the M3 tests exercise the real `LuaWorker` path (worker bundling
  // included) in Node, where there is no browser to run it in.
  test: {
    environment: 'node',
    include: ['tests/**/*.test.{ts,tsx}'],
    testTimeout: 30_000,
  },
  // Monaco is large; keep chunks predictable so the bundle budget is visible.
  build: {
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        // Function form: Vite 8's Rollup types no longer accept the object form.
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          if (id.includes('monaco-editor')) return 'monaco';
          if (id.includes('/react/') || id.includes('/react-dom/') || id.includes('/scheduler/')) {
            return 'react';
          }
          return undefined;
        },
      },
    },
  },
});
