import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';
import type { Plugin } from 'vite';

const root = fileURLToPath(new URL('.', import.meta.url));

// The renderer's Content-Security-Policy blocks inline scripts, which Vite's dev
// server needs for hot reload. Drop the CSP tag only while developing.
const devCsp = (): Plugin => ({
  name: 'gamespeaker-dev-csp',
  apply: 'serve',
  transformIndexHtml: (html) => html.replace(/<meta http-equiv="Content-Security-Policy"[^>]*>/, ''),
});

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: { rollupOptions: { input: resolve(root, 'src/main/index.ts') } },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: { rollupOptions: { input: resolve(root, 'src/preload/index.ts'), output: { format: 'cjs', entryFileNames: '[name].cjs' } } },
  },
  renderer: {
    root: resolve(root, 'src/renderer'),
    plugins: [react(), devCsp()],
    define: {
      __SERVER_URL__: JSON.stringify(process.env.GAMESPEAKER_SERVER_URL ?? ''),
    },
    build: { rollupOptions: { input: resolve(root, 'src/renderer/index.html') } },
  },
});
