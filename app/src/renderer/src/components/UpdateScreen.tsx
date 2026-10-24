import { useEffect, useState } from 'react';
import { useApp } from '../state/store';
import { bridge } from '../lib/platform';
import { LogoIcon } from './Icons';

export const RELEASES_URL = 'https://github.com/loucaspittashis-bit/gamespeaker/releases/latest';
/** While the server needs a newer app: look again this often if nothing was found. */
const RETRY_MS = 60_000;
/** After this long, also offer the installer by hand. */
const SLOW_MS = 45_000;

/**
 * Covers the app while it updates: finds the new version, downloads it and
 * restarts into it, with nothing to click. Signed-in state is kept.
 */
export function UpdateScreen() {
  const mode = useApp((s) => s.updateScreen);
  const update = useApp((s) => s.update);
  const [slow, setSlow] = useState(false);

  // Too old for the server: look now, then every minute until something turns up.
  useEffect(() => {
    if (mode !== 'required') return;
    const check = () => void bridge?.checkForUpdates().catch(() => {});
    check();
    const retry = setInterval(() => {
      const state = useApp.getState().update.state;
      if (state === 'idle' || state === 'error') check();
    }, RETRY_MS);
    const later = setTimeout(() => setSlow(true), SLOW_MS);
    return () => {
      clearInterval(retry);
      clearTimeout(later);
    };
  }, [mode]);

  // Downloaded: a moment to read the screen, then restart into the new version.
  useEffect(() => {
    if (!mode || update.state !== 'ready') return;
    const t = setTimeout(() => void bridge?.installUpdate(), 1500);
    return () => clearTimeout(t);
  }, [mode, update.state]);

  if (!mode) return null;
  const percent = update.state === 'downloading' ? update.percent : update.state === 'ready' ? 100 : 0;
  const line =
    update.state === 'ready'
      ? `Installing version ${update.version}. Gamecoms opens again by itself in a few seconds.`
      : update.state === 'downloading'
        ? `Downloading the new version… ${update.percent}%`
        : update.state === 'error'
          ? `Couldn't get the update: ${update.message}. Trying again in a minute.`
          : update.state === 'checking'
            ? 'Looking for the new version…'
            : mode === 'required'
              ? 'The new version isn’t out yet. Looking again every minute.'
              : 'Getting ready…';

  return (
    <div className="upd-screen" role="alertdialog" aria-modal="true" aria-labelledby="upd-title" aria-describedby="upd-line">
      <div className="upd-card">
        <span className="logo upd-logo"><LogoIcon size="l" /></span>
        <h2 id="upd-title">Updating Gamecoms</h2>
        {mode === 'required' && <p className="upd-why">This server needs a newer version of the app, so it's updating now.</p>}
        <div className="upd-bar" aria-hidden="true">
          <i className={update.state === 'downloading' || update.state === 'ready' ? '' : 'busy'} style={{ width: `${Math.max(percent, 8)}%` }} />
        </div>
        <p id="upd-line" className="upd-line" aria-live="polite">{line}</p>
        {(slow || update.state === 'error') && update.state !== 'ready' && (
          <p className="upd-manual">
            Taking too long? <a href={RELEASES_URL} target="_blank" rel="noreferrer">Download the installer</a> and run it. You stay signed in.
          </p>
        )}
      </div>
    </div>
  );
}
