/// <reference types="vitest/config" />
import { readdir, readFile } from 'node:fs/promises';
import { dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

const monacoEsm = fileURLToPath(
  new URL('./node_modules/monaco-editor/esm/vs', import.meta.url),
);

const isolationHeaders = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
};

const wasmerSdkDist = dirname(fileURLToPath(import.meta.resolve('@wasmer/sdk/browser')));

/** Vite emits the SDK's worker entrypoint by URL but doesn't follow its imports. */
function wasmerSdkRuntimeAssets(): Plugin {
  return {
    name: 'wasmer-sdk-runtime-assets',
    async generateBundle() {
      const visited = new Set<string>();
      const emitWorkerImports = async (file: string, emit = true): Promise<void> => {
        if (visited.has(file)) return;
        visited.add(file);
        const source = await readFile(file, 'utf8');
        if (emit) {
          this.emitFile({
            type: 'asset',
            fileName: `assets/${relative(wasmerSdkDist, file).split(sep).join('/')}`,
            source,
          });
        }
        for (const statement of this.parse(source).body) {
          if (
            (statement.type === 'ImportDeclaration' ||
              statement.type === 'ExportNamedDeclaration' ||
              statement.type === 'ExportAllDeclaration') &&
            typeof statement.source?.value === 'string' &&
            statement.source.value.startsWith('.')
          ) {
            await emitWorkerImports(resolve(dirname(file), statement.source.value));
          }
        }
      };

      const emitDirectory = async (sourceDirectory: string, outputDirectory: string): Promise<void> => {
        for (const entry of await readdir(sourceDirectory, { withFileTypes: true })) {
          const sourcePath = resolve(sourceDirectory, entry.name);
          const outputPath = `${outputDirectory}/${entry.name}`;
          if (entry.isDirectory()) {
            await emitDirectory(sourcePath, outputPath);
          } else if (entry.isFile()) {
            this.emitFile({
              type: 'asset',
              fileName: outputPath,
              source: await readFile(sourcePath),
            });
          }
        }
      };

      // Follow the installed SDK's worker imports instead of hard-coding a list:
      // a missing companion module leaves Bash looking Ready but unable to run.
      await emitWorkerImports(resolve(wasmerSdkDist, 'browser-worker.js'), false);
      await emitDirectory(resolve(wasmerSdkDist, '../pkg/snippets'), 'assets/snippets');
    },
  };
}

// The app is a static site (client-only, local-first). The dev server must accept
// the Arena preview origin, so no host/origin allowlist is applied.
export default defineConfig({
  plugins: [react(), wasmerSdkRuntimeAssets()],
  optimizeDeps: {
    // Keep the SDK's worker and WebAssembly module URLs intact in development.
    exclude: ['@wasmer/sdk'],
  },
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
    headers: isolationHeaders,
  },
  preview: {
    host: '0.0.0.0',
    port: 4173,
    strictPort: true,
    allowedHosts: true,
    headers: isolationHeaders,
  },
  // Workers must be ES modules: Monaco's editor worker is emitted as one, and
  // ES output is what Vite's worker pipeline expects here.
  worker: {
    format: 'es',
  },
  // Tests run in Node by default; jsdom is opted into per-file where the real
  // DOM is needed (Monaco cannot mount there, so it is mocked).
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
