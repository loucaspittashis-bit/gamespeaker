import type { CSSProperties } from 'react';
import { setApp } from '../state/store';
import { useSettings, updateSettings, type Glow } from '../lib/settings';
import { NEON_PRESETS, neonName } from '../lib/theme';

export const GLOW_OPTIONS: { key: Glow; label: string }[] = [
  { key: 'off', label: 'Off' },
  { key: 'soft', label: 'Soft' },
  { key: 'full', label: 'Full' },
];

export function NeonPicker() {
  const neon = useSettings((s) => s.neon);
  const glow = useSettings((s) => s.glow);
  return (
    <>
      <button className="pop-backdrop" aria-label="Close neon picker" onClick={() => setApp({ popover: null })} />
      <div className="pop neon-pop" role="dialog" aria-label="Neon color">
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 12 }}>
          <span className="disp" style={{ fontWeight: 700, fontSize: 15 }}>Neon</span>
          <span style={{ fontSize: 12, color: 'var(--mute)' }}>{neonName(neon)}</span>
        </div>
        <div className="swatches">
          {NEON_PRESETS.map((p) => (
            <button
              key={p.hex}
              className="swatch"
              title={p.name}
              aria-label={p.name}
              aria-pressed={p.hex.toLowerCase() === neon.toLowerCase()}
              style={{ background: p.hex, '--sw': p.hex } as CSSProperties}
              onClick={() => updateSettings({ neon: p.hex })}
            />
          ))}
        </div>
        <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 14, fontSize: 13, fontWeight: 600, color: 'var(--sub)' }}>
          Custom color
          <input className="color-input" type="color" value={neon} onChange={(e) => updateSettings({ neon: e.target.value })} />
        </label>
        <div className="label" style={{ margin: '14px 0 6px' }}>Glow</div>
        <div className="seg">
          {GLOW_OPTIONS.map((g) => (
            <button key={g.key} aria-pressed={glow === g.key} onClick={() => updateSettings({ glow: g.key })}>{g.label}</button>
          ))}
        </div>
        <button
          className="btn-plain"
          style={{ marginTop: 14, width: '100%', borderRadius: 10 }}
          onClick={() => setApp({ popover: null, modal: 'settings', settingsSection: 'appearance' })}
        >
          More in Settings · Appearance
        </button>
      </div>
    </>
  );
}
