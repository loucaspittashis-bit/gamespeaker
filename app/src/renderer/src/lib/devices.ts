// Headsets come and go (USB, Bluetooth). Use the mic or speakers chosen in
// settings while they're plugged in, the system default while they're not,
// and switch back when they return.

export type AudioKind = 'audioinput' | 'audiooutput';

/** The device to open for `chosen`: itself while it's connected, else 'default'. */
export async function pickDevice(kind: AudioKind, chosen: string): Promise<string> {
  if (!chosen || chosen === 'default') return 'default';
  try {
    const devices = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === kind);
    // Without permission the browser hides device ids; then trust the choice.
    if (!devices.some((d) => d.deviceId)) return chosen;
    return devices.some((d) => d.deviceId === chosen) ? chosen : 'default';
  } catch {
    return chosen;
  }
}

/**
 * Which device "default" means right now (its name), so a change of the
 * system's default (a headset plugged in) can be noticed. '' if unknown.
 */
export async function defaultDeviceName(kind: AudioKind): Promise<string> {
  try {
    return (await navigator.mediaDevices.enumerateDevices()).find((d) => d.kind === kind && d.deviceId === 'default')?.label ?? '';
  } catch {
    return '';
  }
}

/** Calls back whenever an audio device is plugged in or removed. */
export function onDevicesChanged(cb: () => void): () => void {
  const md = navigator.mediaDevices;
  if (!md?.addEventListener) return () => {};
  md.addEventListener('devicechange', cb);
  return () => md.removeEventListener('devicechange', cb);
}

type SinkContext = AudioContext & { setSinkId?: (id: string) => Promise<void> };

/** Points an AudioContext at an output device ('default' = the system's). */
export async function setContextOutput(ctx: AudioContext, deviceId: string): Promise<void> {
  const sink = ctx as SinkContext;
  if (sink.setSinkId) await sink.setSinkId(deviceId === 'default' ? '' : deviceId).catch(() => {});
}
