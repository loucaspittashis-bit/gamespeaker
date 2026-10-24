// Which version of the desktop app is calling. Electron puts the app's name and
// version in its user agent ("... Gamecoms/0.1.9 Chrome/..."); the first builds
// were called Gamespeaker. Browsers have neither, so the web app is never held back.

const APP_IN_USER_AGENT = /\b(?:Gamecoms|Gamespeaker)\/(\d+\.\d+\.\d+)\b/;
export const VERSION = /^\d+\.\d+\.\d+$/;

/** "0.1.9" from a desktop app's user agent, or null (browser, or unknown). */
export function appVersion(userAgent: string | undefined): string | null {
  return userAgent?.match(APP_IN_USER_AGENT)?.[1] ?? null;
}

/** True when version `a` is older than `b` (both "x.y.z"). */
export function isOlder(a: string, b: string): boolean {
  const x = a.split('.').map(Number);
  const y = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) < (y[i] ?? 0);
  }
  return false;
}
