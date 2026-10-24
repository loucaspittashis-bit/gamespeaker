import { Fragment, useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { useApp, setApp, type SettingsSection } from '../state/store';
import { logout } from '../lib/actions';
import { listDevices } from '../lib/mic';
import { bridge, defaultServerUrl, isDesktop } from '../lib/platform';
import { useSettings, updateSettings, type NoiseLevel } from '../lib/settings';
import { sounds } from '../lib/sounds';
import { NEON_PRESETS, neonName } from '../lib/theme';
import { setMicTest } from '../lib/voice';
import { AdminSettings } from './AdminSettings';
import { ProfileSettings } from './ProfileEditor';
import { Avatar } from './Avatar';
import { GLOW_OPTIONS } from './NeonPicker';
import { CloseIcon } from './Icons';

function Toggle({ on, onChange, title, desc, disabled }: { on: boolean; onChange: (v: boolean) => void; title: string; desc?: string; disabled?: boolean }) {
  return (
    <button className="toggle-row" aria-pressed={on} disabled={disabled} onClick={() => onChange(!on)} style={disabled ? { opacity: 0.5 } : undefined}>
      <span className="t"><b>{title}</b>{desc && <small>{desc}</small>}</span>
      <span className="switch" />
    </button>
  );
}

function Card({ label, children }: { label?: string; children: ReactNode }) {
  return (
    <div className="card">
      {label && <span className="label">{label}</span>}
      {children}
    </div>
  );
}

// ---------------- Appearance ----------------

function Appearance() {
  const neon = useSettings((s) => s.neon);
  const glow = useSettings((s) => s.glow);
  return (
    <>
      <h1>Appearance</h1>
      <p className="lead">A neutral graphite base with one neon accent. Changes apply to the whole app straight away.</p>
      <Card label="Preview">
        <div className="preview" style={{ '--ring-gap': 'var(--raised)' } as CSSProperties}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 10, background: 'var(--raised)', borderRadius: 12, padding: '8px 12px', boxShadow: 'inset 0 0 0 1px var(--neon-line-soft)' }}>
            <Avatar name="N" color="#ffb27a" size={32} speaking />
            <b>nikos</b>
            <span className="eq" aria-hidden="true"><span /><span /><span /></span>
          </span>
          <span className="chip neon">87 ms</span>
          <span className="btn-neon" aria-hidden="true">Go Live</span>
          <span className="switch on" aria-hidden="true" />
        </div>
      </Card>
      <Card>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 14 }}>
          <span className="label">Neon color</span>
          <span className="disp" style={{ fontSize: 13, fontWeight: 700, color: 'var(--neon)', textShadow: 'var(--glow-text)' }}>
            {neonName(neon)} · {neon.toUpperCase()}
          </span>
        </div>
        <div className="swatch-cards">
          {NEON_PRESETS.map((p) => (
            <button
              key={p.hex}
              className="swatch-card"
              aria-pressed={p.hex.toLowerCase() === neon.toLowerCase()}
              style={{ '--sw': p.hex } as CSSProperties}
              onClick={() => updateSettings({ neon: p.hex })}
            >
              <i />
              {p.name}
            </button>
          ))}
        </div>
        <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginTop: 16, paddingTop: 14, borderTop: '1px solid var(--line)', fontWeight: 700 }}>
          <span style={{ display: 'flex', flexDirection: 'column' }}>
            Custom color
            <small style={{ fontSize: 12, fontWeight: 500, color: 'var(--mute)' }}>Any color works. Brighter colors glow best on the dark base.</small>
          </span>
          <input className="color-input" style={{ width: 56, height: 34 }} type="color" value={neon} onChange={(e) => updateSettings({ neon: e.target.value })} />
        </label>
      </Card>
      <Card label="Glow">
        <div className="seg" style={{ maxWidth: 360 }}>
          {GLOW_OPTIONS.map((g) => <button key={g.key} aria-pressed={glow === g.key} onClick={() => updateSettings({ glow: g.key })}>{g.label}</button>)}
        </div>
        <div style={{ fontSize: 13, color: 'var(--mute)', marginTop: 10 }}>
          {glow === 'off' ? 'Flat neon lines, no glow. Easiest on the eyes.' : glow === 'soft' ? 'A light halo on active and speaking states.' : 'Full neon: speaking rings, live streams and buttons glow.'}
        </div>
      </Card>
    </>
  );
}

// ---------------- Voice ----------------

const NOISE: { key: NoiseLevel; label: string; desc: string }[] = [
  { key: 'off', label: 'Off', desc: 'Your mic as-is.' },
  { key: 'standard', label: 'Standard', desc: 'RNNoise. Removes fans, hum and room noise. Very light on CPU.' },
  { key: 'high', label: 'High', desc: 'GTCRN neural model. Also cleans keyboard clicks and voices in the room. Uses more CPU.' },
];

function useDevices() {
  const [devices, setDevices] = useState<{ inputs: MediaDeviceInfo[]; outputs: MediaDeviceInfo[] }>({ inputs: [], outputs: [] });
  useEffect(() => {
    const load = () => void listDevices().then(setDevices).catch(() => {});
    load();
    navigator.mediaDevices.addEventListener('devicechange', load);
    return () => navigator.mediaDevices.removeEventListener('devicechange', load);
  }, []);
  return devices;
}

function PttRecorder() {
  const desktop = useSettings((s) => s.pttDesktop);
  const web = useSettings((s) => s.pttWeb);
  const [recording, setRecording] = useState(false);

  const record = async () => {
    setRecording(true);
    if (bridge) {
      const b = await bridge.recordPttBinding();
      if (b) updateSettings({ pttDesktop: b });
      setRecording(false);
    }
  };

  return (
    <button
      className={`recorder${recording ? ' rec' : ''}`}
      onClick={() => void record()}
      onKeyDown={(e) => {
        if (bridge || !recording) return;
        e.preventDefault();
        if (e.key !== 'Escape') updateSettings({ pttWeb: { code: e.code, label: e.key.length === 1 ? e.key.toUpperCase() : e.code } });
        setRecording(false);
      }}
      onBlur={() => !bridge && setRecording(false)}
    >
      <b>{recording ? 'Press a key or mouse button…' : (bridge ? desktop?.label : web?.label) ?? 'Not set'}</b>
      <small>{recording ? 'Esc to cancel' : 'Click to change'}</small>
    </button>
  );
}

function Voice() {
  const s = useSettings();
  const level = useApp((st) => st.micLevel);
  const inVoice = useApp((st) => Boolean(st.voiceChannel));
  const devices = useDevices();
  const [testing, setTesting] = useState(false);
  const live = inVoice || testing;

  useEffect(() => () => void setMicTest(false), []);

  const toggleTest = () => {
    const next = !testing;
    setTesting(next);
    void setMicTest(next);
  };

  const pct = (db: number) => Math.max(0, Math.min(100, db + 100));

  return (
    <>
      <h1>Voice &amp; audio</h1>
      <p className="lead">Pick your devices, how your mic turns on, and how much cleanup it gets.</p>
      <Card>
        <div className="card-grid">
          <div>
            <label className="label" htmlFor="indev" style={{ display: 'block', marginBottom: 8 }}>Microphone</label>
            <select id="indev" className="field" value={s.inputDevice} onChange={(e) => updateSettings({ inputDevice: e.target.value })}>
              <option value="default">Default</option>
              {devices.inputs.filter((d) => d.deviceId !== 'default').map((d, i) => <option key={d.deviceId} value={d.deviceId}>{d.label || `Microphone ${i + 1}`}</option>)}
            </select>
            <label htmlFor="invol" style={{ display: 'flex', justifyContent: 'space-between', margin: '14px 0 4px', fontSize: 13, fontWeight: 700 }}>
              <span>Input volume</span><span style={{ color: 'var(--neon)' }}>{s.inputVolume}%</span>
            </label>
            <input id="invol" type="range" min={0} max={200} value={s.inputVolume} onChange={(e) => updateSettings({ inputVolume: Number(e.target.value) })} />
          </div>
          <div>
            <label className="label" htmlFor="outdev" style={{ display: 'block', marginBottom: 8 }}>Speakers</label>
            <select id="outdev" className="field" value={s.outputDevice} onChange={(e) => updateSettings({ outputDevice: e.target.value })}>
              <option value="default">Default</option>
              {devices.outputs.filter((d) => d.deviceId !== 'default').map((d, i) => <option key={d.deviceId} value={d.deviceId}>{d.label || `Speakers ${i + 1}`}</option>)}
            </select>
            <label htmlFor="outvol" style={{ display: 'flex', justifyContent: 'space-between', margin: '14px 0 4px', fontSize: 13, fontWeight: 700 }}>
              <span>Output volume</span><span style={{ color: 'var(--neon)' }}>{s.outputVolume}%</span>
            </label>
            <input id="outvol" type="range" min={0} max={200} value={s.outputVolume} onChange={(e) => updateSettings({ outputVolume: Number(e.target.value) })} />
          </div>
          <div style={{ gridColumn: '1 / -1', display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
            <button className="btn-soft" onClick={toggleTest}>{testing ? 'Stop test' : 'Test mic'}</button>
            <span className="meter" style={{ flex: 1, minWidth: 180 }}>
              <span className={`fill${live && level.open ? ' on' : ''}`} style={{ width: `${live ? pct(level.db) : 0}%` }} />
            </span>
            <small style={{ width: '100%', color: 'var(--mute)', fontSize: 12 }}>
              {testing ? 'Talk now. You hear yourself the way friends do, after noise suppression.' : 'Hear yourself the way your friends do.'}
            </small>
          </div>
        </div>
      </Card>

      <Card label="Mic turns on with">
        <div className="seg" style={{ maxWidth: 360 }}>
          <button aria-pressed={s.inputMode === 'va'} onClick={() => updateSettings({ inputMode: 'va' })}>Voice activity</button>
          <button aria-pressed={s.inputMode === 'ptt'} onClick={() => updateSettings({ inputMode: 'ptt' })}>Push to talk</button>
        </div>
        {s.inputMode === 'va' ? (
          <div style={{ marginTop: 16 }}>
            <Toggle on={s.autoSensitivity} onChange={(v) => updateSettings({ autoSensitivity: v })} title="Set sensitivity automatically" />
            <div style={{ marginTop: 6, fontSize: 13, fontWeight: 700, display: 'flex', justifyContent: 'space-between' }}>
              <span>Input sensitivity</span>
              <span style={{ color: 'var(--mute)' }}>{s.autoSensitivity ? `Automatic (${Math.round(level.threshold)} dB)` : `${s.sensitivity} dB`}</span>
            </div>
            <div className="meter" style={{ marginTop: 8 }}>
              <span className={`fill${live && level.open ? ' on' : ''}`} style={{ width: `${live ? pct(level.db) : 0}%` }} />
              <span className="mark" style={{ left: `${pct(s.autoSensitivity ? level.threshold : s.sensitivity)}%` }} />
            </div>
            <input
              aria-label="Input sensitivity"
              type="range"
              min={-100}
              max={0}
              value={s.autoSensitivity ? Math.round(level.threshold) : s.sensitivity}
              disabled={s.autoSensitivity}
              onChange={(e) => updateSettings({ sensitivity: Number(e.target.value) })}
              style={{ marginTop: 6 }}
            />
            <div style={{ fontSize: 12, color: 'var(--mute)' }}>
              {live ? 'The bar lights up when your mic would send. Drag the line just under your normal speaking level.' : 'Press Test mic (or join voice) to see your level.'}
            </div>
          </div>
        ) : (
          <div className="card-grid" style={{ marginTop: 16 }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>Shortcut</div>
              <PttRecorder />
            </div>
            <div>
              <label htmlFor="rel" style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, fontWeight: 700, marginBottom: 8 }}>
                <span>Release delay</span><span style={{ color: 'var(--neon)' }}>{s.pttRelease} ms</span>
              </label>
              <input id="rel" type="range" min={0} max={1000} step={10} value={s.pttRelease} onChange={(e) => updateSettings({ pttRelease: Number(e.target.value) })} />
              <div style={{ fontSize: 12, color: 'var(--mute)' }}>Keeps the mic open a moment after you let go, so your last word isn't cut off.</div>
            </div>
            <div style={{ gridColumn: '1 / -1', fontSize: 12, color: 'var(--mute)' }}>
              {isDesktop ? 'Works while a game has focus, and the game still gets the key.' : 'In the browser, push-to-talk only works while this tab has focus. The desktop app works everywhere.'}
            </div>
          </div>
        )}
      </Card>

      <Card label="Noise suppression">
        <div className="ns">
          {NOISE.map((n) => (
            <button key={n.key} aria-pressed={s.noise === n.key} onClick={() => updateSettings({ noise: n.key })}>
              <b>{n.label}</b>
              <small>{n.desc}</small>
            </button>
          ))}
        </div>
        <div className="hr" style={{ margin: '16px 0 6px' }} />
        <Toggle on={s.echoCancellation} onChange={(v) => updateSettings({ echoCancellation: v })} title="Echo cancellation" desc="Stops friends hearing themselves through your speakers." />
        <Toggle on={s.autoGain} onChange={(v) => updateSettings({ autoGain: v })} title="Automatic gain control" desc="Evens out your volume when you lean back or get loud." />
        <Toggle on={s.packetLossProtection} onChange={(v) => updateSettings({ packetLossProtection: v })} title="Packet loss protection" desc="Opus FEC and RED. Keeps your voice clear on shaky Wi-Fi. Applies next time you join." />
      </Card>
    </>
  );
}

// ---------------- Keybinds ----------------

function Keys() {
  const desktop = useSettings((s) => s.pttDesktop);
  const web = useSettings((s) => s.pttWeb);
  const mode = useSettings((s) => s.inputMode);
  const rows = [
    { action: 'Push to talk', keys: (isDesktop ? desktop?.label : web?.label) ?? 'Not set', note: mode === 'ptt' ? '' : 'turn on in Voice & audio' },
    { action: 'Toggle mute', keys: 'Ctrl + Shift + M' },
    { action: 'Toggle deafen', keys: 'Ctrl + Shift + D' },
    { action: 'Close menus and dialogs', keys: 'Esc' },
  ];
  return (
    <>
      <h1>Keybinds</h1>
      <p className="lead">
        {isDesktop ? 'Push to talk works while you are in a game, and the game still gets the key. The others work while Gamespeaker is focused.' : 'These work while this tab is focused.'}
      </p>
      <div className="card" style={{ padding: '6px 18px' }}>
        {rows.map((r) => (
          <div key={r.action} className="keyrow">
            <b>{r.action}{r.note && <small style={{ color: 'var(--mute)', fontWeight: 500 }}> · {r.note}</small>}</b>
            <span className="keycap">{r.keys}</span>
          </div>
        ))}
      </div>
      <div style={{ marginTop: 12 }}>
        <div className="label" style={{ marginBottom: 8 }}>Change push to talk</div>
        <div style={{ maxWidth: 360 }}><PttRecorder /></div>
      </div>
    </>
  );
}

// ---------------- Streaming ----------------

function Streaming() {
  const s = useSettings();
  const quality = `${s.streamRes}${s.streamFps}`;
  return (
    <>
      <h1>Streaming</h1>
      <p className="lead">Defaults for Go Live, and how you watch other people.</p>
      <Card>
        <div className="card-grid">
          <div>
            <div className="label" style={{ marginBottom: 8 }}>Default quality</div>
            <div className="seg">
              {(['1080p60', '1440p60'] as const).map((q) => (
                <button key={q} aria-pressed={quality === q} onClick={() => updateSettings({ streamRes: q.replace('60', '') as '1080p' | '1440p', streamFps: 60 })}>{q}</button>
              ))}
            </div>
          </div>
          <div>
            <div className="label" style={{ marginBottom: 8 }}>Codec</div>
            <div className="seg">
              <button aria-pressed={s.codecPref === 'auto'} onClick={() => updateSettings({ codecPref: 'auto' })}>Automatic</button>
              <button aria-pressed={s.codecPref === 'h264'} onClick={() => updateSettings({ codecPref: 'h264' })}>H.264 only</button>
            </div>
            <div style={{ fontSize: 12, color: 'var(--mute)', marginTop: 7 }}>
              {s.codecPref === 'auto' ? 'AV1 when your graphics card supports it, otherwise H.264.' : 'Most compatible. Uses a bit more bandwidth for the same quality.'}
            </div>
          </div>
        </div>
      </Card>
      <div className="card" style={{ padding: '8px 18px' }}>
        <Toggle on={s.showStreamStats} onChange={(v) => updateSettings({ showStreamStats: v })} title="Show stream stats" desc="Resolution, frame rate, codec and bitrate when you hover a stream." />
      </div>
    </>
  );
}

// ---------------- App ----------------

function AppSection() {
  const s = useSettings();
  const update = useApp((st) => st.update);
  const gamesSupported = useApp((st) => st.gamesSupported);
  const [launch, setLaunch] = useState(false);
  const [server, setServer] = useState(s.serverUrl ?? '');

  useEffect(() => {
    void bridge?.getLaunchAtLogin().then(setLaunch);
  }, []);

  return (
    <>
      <h1>App</h1>
      <p className="lead">Startup, sounds, the tray, and where the server lives.</p>
      <div className="card" style={{ padding: '8px 18px' }}>
        <Toggle
          on={s.soundEffects}
          onChange={(v) => {
            updateSettings({ soundEffects: v });
            if (v) sounds.join();
          }}
          title="Sound effects"
          desc="Soft chimes when people join or leave your voice channel, go live, or message you."
        />
        <Toggle
          on={s.mentionNotifications}
          onChange={(v) => {
            updateSettings({ mentionNotifications: v });
            // The browser asks once; the desktop app is always allowed.
            if (v && typeof Notification !== 'undefined' && Notification.permission === 'default') void Notification.requestPermission();
          }}
          title="Pop-up when someone @mentions you"
          desc="A desktop notification when you're in another channel or another app. Do Not Disturb turns it off."
        />
        {gamesSupported && (
          <>
            <Toggle
              on={s.detectGames}
              onChange={(v) => updateSettings({ detectGames: v })}
              title="Detect games"
              desc="Spots the game you have open, so Go Live becomes one click: Stream VALORANT."
            />
            <Toggle
              on={s.showPlaying}
              disabled={!s.detectGames}
              onChange={(v) => updateSettings({ showPlaying: v })}
              title="Show what I'm playing"
              desc="Friends see “Playing …” under your name."
            />
          </>
        )}
        {isDesktop && (
          <>
            <Toggle on={launch} onChange={(v) => { setLaunch(v); void bridge?.setLaunchAtLogin(v); }} title="Start with your computer" desc="Opens quietly in the tray so friends can reach you." />
            <Toggle on={s.closeToTray} onChange={(v) => { updateSettings({ closeToTray: v }); void bridge?.setCloseToTray(v); }} title="Close to tray" desc="Closing the window keeps you in voice. Quit from the tray icon." />
          </>
        )}
      </div>
      <Card label="Server address">
        <div style={{ display: 'flex', gap: 10 }}>
          <input className="field" value={server} placeholder={defaultServerUrl()} onChange={(e) => setServer(e.target.value)} />
          <button
            className="btn-plain"
            onClick={() => {
              updateSettings({ serverUrl: server.trim() || null });
              void logout();
            }}
          >
            Save
          </button>
        </div>
        <div style={{ fontSize: 12, color: 'var(--mute)', marginTop: 8 }}>Only change this if the server moved. Saving signs you out.</div>
      </Card>
      {isDesktop && (
        <Card label="Updates">
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ flex: 1 }}>
              Gamespeaker {bridge?.version} ·{' '}
              {update.state === 'ready' ? `version ${update.version} is ready` : update.state === 'downloading' ? `downloading (${update.percent}%)` : update.state === 'error' ? 'could not check for updates' : 'up to date'}
            </span>
            {update.state === 'ready' && <button className="btn-neon" onClick={() => void bridge?.installUpdate()}>Restart to update</button>}
          </div>
        </Card>
      )}
    </>
  );
}

const SECTIONS: { key: SettingsSection; label: string; render: () => ReactNode; admin?: boolean }[] = [
  { key: 'profile', label: 'My profile', render: () => <ProfileSettings /> },
  { key: 'appearance', label: 'Appearance', render: () => <Appearance /> },
  { key: 'voice', label: 'Voice & audio', render: () => <Voice /> },
  { key: 'keys', label: 'Keybinds', render: () => <Keys /> },
  { key: 'stream', label: 'Streaming', render: () => <Streaming /> },
  { key: 'app', label: 'App', render: () => <AppSection /> },
  { key: 'admin', label: 'Server admin', render: () => <AdminSettings />, admin: true },
];

export function SettingsModal() {
  const section = useApp((s) => s.settingsSection);
  const update = useApp((s) => s.update);
  const adminAvailable = useApp((s) => s.adminAvailable);
  const sections = SECTIONS.filter((x) => !x.admin || adminAvailable);
  const current = sections.find((x) => x.key === section) ?? SECTIONS[2]!;
  return (
    <div className="settings" role="dialog" aria-modal="true" aria-label="Settings">
      <nav aria-label="Settings sections">
        <div className="in">
          <div className="label">Settings</div>
          {sections.map((x) => (
            <Fragment key={x.key}>
              {x.admin && <div className="label group">Server</div>}
              <button aria-current={x.key === current.key ? 'page' : undefined} onClick={() => setApp({ settingsSection: x.key })}>
                {x.label}
              </button>
            </Fragment>
          ))}
          <div className="ver">
            <b>Gamespeaker {bridge?.version ?? 'web'}</b>
            <span>{update.state === 'ready' ? 'Update ready · restart to install' : isDesktop ? 'Updates install automatically' : 'Web version'}</span>
          </div>
        </div>
      </nav>
      <div className="content scroll">
        <div className="close-x">
          <button aria-label="Close settings" onClick={() => setApp({ modal: null })}><CloseIcon size="s" /></button>
          <span>ESC</span>
        </div>
        <div className="in">{current.render()}</div>
      </div>
    </div>
  );
}
