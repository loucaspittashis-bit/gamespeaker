import { useState } from 'react';
import type { Status } from '../lib/gateway';
import { updateSettings, useSettings } from '../lib/settings';

export const STATUS_LABEL: Record<Status, string> = { online: 'Online', idle: 'Idle', dnd: 'Do Not Disturb' };

const OPTIONS: { key: Status; hint: string }[] = [
  { key: 'online', hint: "Goes idle by itself when you're away" },
  { key: 'idle', hint: 'Show as away' },
  { key: 'dnd', hint: 'No message sounds or pop-ups' },
];

const EMOJI = ['🎮', '💀', '🔥', '😴', '🎧', '📺', '🍕', '🏆', '😎', '👀', '🧠', '⏳', '🤬', '🫠', '✨', '💼'];

const CLEAR_AFTER: { label: string; until: () => number | null }[] = [
  { label: "Don't clear", until: () => null },
  { label: '1 hour', until: () => Date.now() + 3_600_000 },
  { label: '4 hours', until: () => Date.now() + 4 * 3_600_000 },
  {
    label: 'Today',
    until: () => {
      const d = new Date();
      d.setHours(23, 59, 59, 999);
      return d.getTime();
    },
  },
];

/** Your status and custom status, inside your own profile card. */
export function StatusEditor() {
  const status = useSettings((s) => s.status);
  const custom = useSettings((s) => s.customStatus);
  const [emoji, setEmoji] = useState(custom?.emoji ?? '🎮');
  const [text, setText] = useState(custom?.text ?? '');
  const [clearAfter, setClearAfter] = useState(0);
  const [picking, setPicking] = useState(false);
  const dirty = text.trim() !== (custom?.text ?? '') || (text.trim() !== '' && emoji !== (custom?.emoji ?? emoji));

  const save = () => {
    const t = text.trim();
    updateSettings({ customStatus: t ? { emoji, text: t.slice(0, 60), until: CLEAR_AFTER[clearAfter]!.until() } : null });
  };

  return (
    <div className="status-edit">
      <span className="label">Status</span>
      <div className="st-options" role="radiogroup" aria-label="Status">
        {OPTIONS.map((o) => (
          <button key={o.key} role="radio" aria-checked={status === o.key} onClick={() => updateSettings({ status: o.key })}>
            <i className={`status-dot ${o.key}`} />
            <span>
              <b>{STATUS_LABEL[o.key]}</b>
              <small>{o.hint}</small>
            </span>
          </button>
        ))}
      </div>

      <span className="label" style={{ marginTop: 12 }}>Custom status</span>
      <div className="st-custom">
        <button className="st-emoji" aria-label="Pick an emoji" aria-expanded={picking} onClick={() => setPicking(!picking)}>{emoji}</button>
        <input
          className="field"
          placeholder="What are you up to?"
          maxLength={60}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && save()}
        />
      </div>
      {picking && (
        <div className="st-emojis">
          {EMOJI.map((e) => (
            <button
              key={e}
              aria-pressed={e === emoji}
              onClick={() => {
                setEmoji(e);
                setPicking(false);
              }}
            >
              {e}
            </button>
          ))}
        </div>
      )}
      <div className="st-row">
        <select className="field" aria-label="Clear after" value={clearAfter} onChange={(e) => setClearAfter(Number(e.target.value))}>
          {CLEAR_AFTER.map((c, i) => <option key={c.label} value={i}>{c.label}</option>)}
        </select>
        {custom && (
          <button
            className="btn-ghost sm"
            onClick={() => {
              setText('');
              updateSettings({ customStatus: null });
            }}
          >
            Clear
          </button>
        )}
        <button className="btn-soft sm" disabled={!dirty && custom !== null} onClick={save}>Save</button>
      </div>
    </div>
  );
}
