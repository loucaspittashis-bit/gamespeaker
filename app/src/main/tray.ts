import { Menu, Tray, nativeImage, type BrowserWindow } from 'electron';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));

type TrayState = { muted: boolean; deafened: boolean; inVoice: boolean };

export function createTray(opts: { show: () => void; quit: () => void; getWindow: () => BrowserWindow | null }) {
  const iconPath = join(here, process.platform === 'darwin' ? '../../build/trayTemplate.png' : '../../build/tray.png');
  const image = nativeImage.createFromPath(iconPath);
  const tray = new Tray(image.isEmpty() ? nativeImage.createEmpty() : image);
  tray.setToolTip('Gamespeaker');

  let state: TrayState = { muted: false, deafened: false, inVoice: false };
  const action = (name: 'toggle-mute' | 'toggle-deafen' | 'disconnect') => {
    const win = opts.getWindow();
    if (win && !win.isDestroyed()) win.webContents.send('tray:action', name);
  };

  const render = () => {
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: 'Open Gamespeaker', click: opts.show },
        { type: 'separator' },
        { label: 'Mute', type: 'checkbox', checked: state.muted, click: () => action('toggle-mute') },
        { label: 'Deafen', type: 'checkbox', checked: state.deafened, click: () => action('toggle-deafen') },
        { label: 'Leave voice', enabled: state.inVoice, click: () => action('disconnect') },
        { type: 'separator' },
        { label: 'Quit', click: opts.quit },
      ]),
    );
    tray.setToolTip(state.inVoice ? `Gamespeaker: in voice${state.muted ? ', muted' : ''}` : 'Gamespeaker');
  };

  tray.on('click', opts.show);
  render();

  return {
    setState(next: TrayState) {
      state = { muted: Boolean(next.muted), deafened: Boolean(next.deafened), inVoice: Boolean(next.inVoice) };
      render();
    },
  };
}
