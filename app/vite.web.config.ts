// Builds the same UI as a plain web app, served by Caddy at https://your-domain/.
// Friends on a Mac, a work laptop or a phone can join from Chrome without installing.
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const root = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  root: resolve(root, 'src/renderer'),
  base: '/',
  plugins: [react()],
  define: {
    // Empty: the web build talks to the server it was loaded from.
    __SERVER_URL__: JSON.stringify(''),
  },
  server: {
    port: 5173,
    // Dev: proxy API + presence to the local stack (server/scripts/local-stack.sh).
    proxy: {
      '/api': 'http://localhost:8088',
      '/ws': { target: 'ws://localhost:8088', ws: true },
    },
  },
  build: {
    outDir: resolve(root, '../server/web'),
    emptyOutDir: true,
  },
});
