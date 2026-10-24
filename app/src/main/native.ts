import { createRequire } from 'node:module';

/** CommonJS require for native addons (uiohook, loopback-capture, koffi) from the ESM main process. */
export const nodeRequire = createRequire(import.meta.url);
