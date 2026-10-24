import { useEffect, useState, type CSSProperties, type FormEvent } from 'react';
import { ApiError, serverUrl } from '../lib/api';
import { login } from '../lib/actions';
import { listDevices } from '../lib/mic';
import { defaultServerUrl } from '../lib/platform';
import { AVATAR_COLORS, useSettings, updateSettings } from '../lib/settings';
import { NEON_PRESETS, neonName } from '../lib/theme';
import { Avatar } from './Avatar';
import { ArrowRightIcon, CheckIcon, LockIcon, LogoIcon } from './Icons';

const FEATURES = [
  { title: 'Voice that feels like the same room', sub: 'Noise suppression, echo cancellation, volume per friend.' },
  { title: 'Streams up to 1440p60', sub: 'Several times the bitrate you are used to, with game sound.' },
  { title: 'Always on, only for you', sub: 'Your own server, running 24/7. Chat history stays.' },
];

export function Welcome() {
  const s = useSettings();
  const [name, setName] = useState(s.nickname);
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [devices, setDevices] = useState<{ inputs: MediaDeviceInfo[]; outputs: MediaDeviceInfo[] }>({ inputs: [], outputs: [] });
  const [advanced, setAdvanced] = useState(Boolean(s.serverUrl));
  const [server, setServer] = useState(s.serverUrl ?? '');
  const labelsHidden = devices.inputs.length > 0 && devices.inputs.every((d) => !d.label);
  const nick = name.trim();
  const color = nick ? AVATAR_COLORS[nick.charCodeAt(0) % AVATAR_COLORS.length]! : '#2c3039';

  useEffect(() => {
    void listDevices().then(setDevices).catch(() => {});
  }, []);

  const unlockDevices = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((t) => t.stop());
      setDevices(await listDevices());
    } catch {
      setError('Microphone access was blocked. You can still join and allow it later.');
    }
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!nick || !password) {
      setError('Enter a nickname and the server password first.');
      return;
    }
    setBusy(true);
    setError(null);
    updateSettings({ serverUrl: advanced && server.trim() ? server.trim() : null });
    try {
      await login({ name: nick, password, color });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Try again.');
    } finally {
      setBusy(false);
    }
  };

  let host = '';
  try {
    host = new URL(serverUrl()).host;
  } catch {
    host = serverUrl();
  }

  return (
    <div className="welcome">
      <section className="hero">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span className="logo" style={{ width: 46, height: 46, borderRadius: 14 }}><LogoIcon size="l" /></span>
          <span className="disp" style={{ fontWeight: 700, fontSize: 20 }}>Gamecoms</span>
        </div>
        <h1>Your crew's own <span>voice server.</span></h1>
        <p>Private voice, chat and streams for you and your friends. No accounts, no ads, nobody else.</p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {FEATURES.map((f) => (
            <div key={f.title} className="feature">
              <span className="ok"><CheckIcon size="s" /></span>
              <span><b>{f.title}</b><small>{f.sub}</small></span>
            </div>
          ))}
        </div>
      </section>

      <form className="join-card" onSubmit={(e) => void submit(e)} aria-label="Join the server">
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 6 }}>
          <Avatar name={nick || '?'} color={color} size={64} speaking={Boolean(nick)} />
          <span style={{ display: 'flex', flexDirection: 'column' }}>
            <span className="disp" style={{ fontSize: 22, fontWeight: 700 }}>{nick ? `Hey, ${nick}` : 'Welcome'}</span>
            <span style={{ fontSize: 13, color: 'var(--mute)' }}>Pick a name and enter the password your friend sent you.</span>
          </span>
        </div>

        <div>
          <label className="label" htmlFor="nick">Nickname</label>
          <input id="nick" className="field" value={name} maxLength={32} autoFocus placeholder="What friends call you" onChange={(e) => { setName(e.target.value); setError(null); }} />
        </div>

        <div>
          <label className="label" htmlFor="pw">Server password</label>
          <div className="field pw">
            <input id="pw" type={showPw ? 'text' : 'password'} value={password} placeholder="From your invite" onChange={(e) => { setPassword(e.target.value); setError(null); }} />
            <button type="button" onClick={() => setShowPw(!showPw)} aria-label={showPw ? 'Hide password' : 'Show password'}>{showPw ? 'HIDE' : 'SHOW'}</button>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12 }}>
          <div>
            <label className="label" htmlFor="mic">Microphone</label>
            <select id="mic" className="field" value={s.inputDevice} onChange={(e) => updateSettings({ inputDevice: e.target.value })}>
              <option value="default">Default</option>
              {devices.inputs.filter((d) => d.deviceId !== 'default').map((d, i) => <option key={d.deviceId} value={d.deviceId}>{d.label || `Microphone ${i + 1}`}</option>)}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="spk">Speakers</label>
            <select id="spk" className="field" value={s.outputDevice} onChange={(e) => updateSettings({ outputDevice: e.target.value })}>
              <option value="default">Default</option>
              {devices.outputs.filter((d) => d.deviceId !== 'default').map((d, i) => <option key={d.deviceId} value={d.deviceId}>{d.label || `Speakers ${i + 1}`}</option>)}
            </select>
          </div>
        </div>
        {labelsHidden && (
          <button type="button" className="btn-plain" style={{ alignSelf: 'flex-start', marginTop: -4 }} onClick={() => void unlockDevices()}>
            Show device names (allows mic access)
          </button>
        )}

        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
            <span className="label">Your neon</span>
            <span style={{ fontSize: 12, color: 'var(--neon)', fontWeight: 700 }}>{neonName(s.neon)}</span>
          </div>
          <div className="swatches">
            {NEON_PRESETS.map((p) => (
              <button
                key={p.hex}
                type="button"
                className="swatch"
                style={{ aspectRatio: 'auto', height: 34, background: p.hex, '--sw': p.hex } as CSSProperties}
                title={p.name}
                aria-label={p.name}
                aria-pressed={p.hex.toLowerCase() === s.neon.toLowerCase()}
                onClick={() => updateSettings({ neon: p.hex })}
              />
            ))}
          </div>
          <div style={{ fontSize: 12, color: 'var(--mute)', marginTop: 7 }}>You can change it any time in Settings.</div>
        </div>

        {advanced ? (
          <div>
            <label className="label" htmlFor="srv">Server address</label>
            <input id="srv" className="field" value={server} placeholder={defaultServerUrl()} onChange={(e) => setServer(e.target.value)} />
          </div>
        ) : (
          <button type="button" className="btn-ghost" style={{ alignSelf: 'flex-start', padding: '2px 0', fontSize: 12, color: 'var(--mute)' }} onClick={() => setAdvanced(true)}>
            Use a different server
          </button>
        )}

        <button className="btn-neon" type="submit" disabled={busy} style={{ marginTop: 6, padding: 13, fontSize: 15 }}>
          {busy ? 'Joining…' : 'Join server'}
          <ArrowRightIcon size="s" />
        </button>
        {error && <div className="error" role="alert">{error}</div>}
        <div className="fine"><LockIcon size="xs" />Connecting to {host}</div>
      </form>
    </div>
  );
}
