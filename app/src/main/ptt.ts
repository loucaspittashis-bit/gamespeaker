import { ipcMain, powerMonitor, type BrowserWindow } from 'electron';
import { nodeRequire } from './native';
import type { PttBinding } from '../shared/bridge';

// Global push-to-talk via a low-level keyboard/mouse hook. Unlike Electron's
// globalShortcut it sees key releases, supports mouse side buttons, and never
// swallows the key, so the game still receives it.

type HookEvent = { keycode?: number; button?: unknown };
type Hook = {
  on(event: 'keydown' | 'keyup' | 'mousedown' | 'mouseup', cb: (e: HookEvent) => void): void;
  start(): void;
  stop(): void;
};

let hook: Hook | null = null;
let keyNames = new Map<number, string>();
try {
  const mod = nodeRequire('uiohook-napi');
  hook = mod.uIOhook as Hook;
  keyNames = new Map(Object.entries(mod.UiohookKey as Record<string, number>).map(([name, code]) => [code, name]));
} catch (err) {
  console.warn('global push-to-talk unavailable:', err);
}

const KEY_LABELS: Record<string, string> = {
  Ctrl: 'Left Ctrl', CtrlRight: 'Right Ctrl', Alt: 'Left Alt', AltRight: 'Right Alt',
  Shift: 'Left Shift', ShiftRight: 'Right Shift', Meta: 'Left Win', MetaRight: 'Right Win',
  Backquote: '`', CapsLock: 'Caps Lock', Space: 'Space', Tab: 'Tab', Enter: 'Enter',
};

function keyLabel(code: number): string {
  const name = keyNames.get(code) ?? `Key ${code}`;
  if (KEY_LABELS[name]) return KEY_LABELS[name];
  if (name.startsWith('Numpad')) return `Num ${name.slice(6)}`;
  return name;
}

function mouseLabel(button: number): string {
  return ({ 3: 'Middle mouse', 4: 'Mouse 4', 5: 'Mouse 5' } as Record<number, string>)[button] ?? `Mouse ${button}`;
}

export function registerPtt(getWindow: () => BrowserWindow | null): void {
  let binding: PttBinding | null = null;
  let pressed = false;
  let running = false;
  let recorder: ((b: PttBinding | null) => void) | null = null;

  const send = (value: boolean) => {
    if (pressed === value) return;
    pressed = value;
    const win = getWindow();
    if (win && !win.isDestroyed()) win.webContents.send('ptt', value);
  };

  const sync = () => {
    if (!hook) return;
    const needed = binding !== null || recorder !== null;
    if (needed && !running) {
      hook.start();
      running = true;
    } else if (!needed && running) {
      hook.stop();
      running = false;
    }
  };

  const finishRecording = (b: PttBinding | null) => {
    const done = recorder;
    recorder = null;
    sync();
    done?.(b);
  };

  // The key can be let go where the hook can't see it (Ctrl+Alt+Del, the lock
  // screen, a UAC prompt). Locking or sleeping always ends a push-to-talk press.
  powerMonitor.on('lock-screen', () => send(false));
  powerMonitor.on('suspend', () => send(false));

  if (hook) {
    hook.on('keydown', (e) => {
      const code = Number(e.keycode);
      if (recorder) {
        finishRecording(keyNames.get(code) === 'Escape' ? null : { kind: 'key', code, label: keyLabel(code) });
        return;
      }
      if (binding?.kind === 'key' && binding.code === code) send(true);
    });
    hook.on('keyup', (e) => {
      if (binding?.kind === 'key' && binding.code === Number(e.keycode)) send(false);
    });
    hook.on('mousedown', (e) => {
      const button = Number(e.button);
      if (recorder) {
        // Left and right click are needed to use the app, so they can't be push-to-talk.
        if (button >= 3) finishRecording({ kind: 'mouse', button, label: mouseLabel(button) });
        return;
      }
      if (binding?.kind === 'mouse' && binding.button === button) send(true);
    });
    hook.on('mouseup', (e) => {
      if (binding?.kind === 'mouse' && binding.button === Number(e.button)) send(false);
    });
  }

  ipcMain.handle('ptt:set-binding', (_e, b: PttBinding | null) => {
    binding = b && (b.kind === 'key' || b.kind === 'mouse') ? b : null;
    send(false);
    sync();
  });

  ipcMain.handle('ptt:record', () => {
    if (!hook) return null;
    finishRecording(null);
    return new Promise<PttBinding | null>((resolve) => {
      recorder = resolve;
      sync();
      setTimeout(() => {
        if (recorder === resolve) finishRecording(null);
      }, 15_000);
    });
  });
}
