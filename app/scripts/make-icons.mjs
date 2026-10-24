// Renders the app and tray icons from SVG with Electron itself.
//   npx electron scripts/make-icons.mjs
import { app, BrowserWindow } from 'electron';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const out = fileURLToPath(new URL('../build/', import.meta.url));
mkdirSync(out, { recursive: true });

const NEON = '#2de2ff';

const appIcon = (s) => `
<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 1024 1024">
  <defs>
    <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
      <feGaussianBlur stdDeviation="22" result="b"/>
      <feMerge><feMergeNode in="b"/><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#1a1d23"/><stop offset="1" stop-color="#0a0b0e"/>
    </linearGradient>
  </defs>
  <rect x="64" y="64" width="896" height="896" rx="220" fill="url(#bg)"/>
  <rect x="64" y="64" width="896" height="896" rx="220" fill="none" stroke="${NEON}" stroke-opacity=".35" stroke-width="6"/>
  <g filter="url(#glow)" fill="none" stroke="${NEON}" stroke-width="44" stroke-linecap="round" stroke-linejoin="round">
    <path d="M300 300h424a64 64 0 0 1 64 64v248a64 64 0 0 1-64 64H560l-136 104V676H300a64 64 0 0 1-64-64V364a64 64 0 0 1 64-64z"/>
    <path d="M392 470v36M466 422v132M540 446v84M614 470v36"/>
  </g>
</svg>`;

const trayIcon = (s, color) => `
<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
  <path d="M4 4h16a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-6l-5 4v-4H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z"/>
  <path d="M8 10.5v1M11 8.5v5M14 9.5v3M17 10.5v1"/>
</svg>`;

const targets = [
  { file: 'icon.png', size: 1024, svg: appIcon(1024) },
  { file: 'tray.png', size: 32, svg: trayIcon(32, NEON) },
  { file: 'trayTemplate.png', size: 22, svg: trayIcon(22, '#000000') },
  { file: 'trayTemplate@2x.png', size: 44, svg: trayIcon(44, '#000000') },
];

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    show: false,
    width: 1024,
    height: 1024,
    transparent: true,
    frame: false,
    webPreferences: { offscreen: true },
  });
  for (const t of targets) {
    win.setContentSize(t.size, t.size);
    const html = `<html><body style="margin:0;background:transparent;overflow:hidden">${t.svg}</body></html>`;
    await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
    await new Promise((r) => setTimeout(r, 250));
    const image = await win.webContents.capturePage({ x: 0, y: 0, width: t.size, height: t.size });
    writeFileSync(out + t.file, image.resize({ width: t.size, height: t.size, quality: 'best' }).toPNG());
    console.log('wrote build/' + t.file);
  }
  app.quit();
});
