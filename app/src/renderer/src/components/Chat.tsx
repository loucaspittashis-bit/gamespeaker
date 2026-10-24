import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useApp, setApp } from '../state/store';
import { isChannelVisible, loadOlder, markRead, retryPending, sendChat, sendTyping } from '../lib/actions';
import { formatTime, linkify } from '../lib/format';
import { Avatar } from './Avatar';
import { ChatIcon, CloseIcon, HashIcon, SendIcon } from './Icons';

const GROUP_MS = 5 * 60 * 1000;

function useNow(intervalMs: number): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(t);
  }, [intervalMs]);
  return now;
}

function Text({ text }: { text: string }) {
  return (
    <>
      {linkify(text).map((p, i) =>
        p.href ? <a key={i} href={p.href} target="_blank" rel="noreferrer">{p.text}</a> : <span key={i}>{p.text}</span>,
      )}
    </>
  );
}

function Messages({ channel, wide, intro }: { channel: string; wide?: boolean; intro?: { name: string } }) {
  const messages = useApp((s) => s.messages[channel]);
  const pendingAll = useApp((s) => s.pending);
  const hasMore = useApp((s) => s.hasMore[channel] ?? false);
  const loaded = useApp((s) => s.historyLoaded[channel] ?? false);
  const me = useApp((s) => s.me);
  const ref = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);
  const list = messages ?? [];
  const pending = pendingAll.filter((p) => p.channel === channel);

  // Stay pinned to the newest message unless the user scrolled up to read.
  useLayoutEffect(() => {
    const el = ref.current;
    if (el && atBottom.current) el.scrollTop = el.scrollHeight;
  }, [list.length, pending.length, channel]);

  useEffect(() => {
    if (isChannelVisible(channel)) markRead(channel);
  }, [list.length, channel]);

  useEffect(() => {
    const onFocus = () => isChannelVisible(channel) && markRead(channel);
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [channel]);

  return (
    <div
      className={`messages scroll${wide ? ' wide' : ''}`}
      ref={ref}
      onScroll={(e) => {
        const el = e.currentTarget;
        atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
      }}
    >
      <div className="top" />
      {hasMore && <button className="btn-plain load-older" onClick={() => loadOlder(channel)}>Load older messages</button>}
      {intro && !hasMore && (
        <div className="chat-intro">
          <div className="big-ic"><HashIcon size="l" /></div>
          <h2>Welcome to #{intro.name}</h2>
          <p>History is saved on your own server, so it is still here when you come back.</p>
        </div>
      )}
      {loaded && list.length === 0 && pending.length === 0 && !intro && (
        <div style={{ color: 'var(--mute)', textAlign: 'center', padding: '24px 8px', fontSize: 14 }}>No messages yet. Say hi.</div>
      )}
      {list.map((m, i) => {
        const prev = list[i - 1];
        const cont = prev !== undefined && prev.userId === m.userId && m.ts - prev.ts < GROUP_MS;
        return (
          <div key={m.id} className={`msg${cont ? ' cont' : ''}`}>
            <Avatar name={m.name} color={m.color} size={wide ? 40 : 34} />
            <div className="body">
              {!cont && (
                <div className="meta">
                  <b style={{ color: m.color }}>{m.name}</b>
                  <time dateTime={new Date(m.ts).toISOString()}>{formatTime(m.ts)}</time>
                </div>
              )}
              <div className="text"><Text text={m.text} /></div>
            </div>
          </div>
        );
      })}
      {pending.map((p) => (
        <div key={p.nonce} className={`msg ${p.failed ? 'failed' : 'pending'}`}>
          <Avatar name={me?.name ?? '?'} color={me?.color ?? '#888'} size={wide ? 40 : 34} />
          <div className="body">
            <div className="meta"><b style={{ color: me?.color }}>{me?.name}</b><time>{p.failed ? 'not sent' : 'sending…'}</time></div>
            <div className="text">{p.text}</div>
            {p.failed && <button className="retry" onClick={() => retryPending(p.nonce)}>Try again</button>}
          </div>
        </div>
      ))}
    </div>
  );
}

function Typing({ channel }: { channel: string }) {
  const typing = useApp((s) => s.typing[channel]);
  const meId = useApp((s) => s.me?.id);
  const now = useNow(1000);
  const names = Object.entries(typing ?? {})
    .filter(([id, t]) => id !== meId && t.until > now)
    .map(([, t]) => t.name);
  return (
    <div className="typing" aria-live="polite">
      {names.length > 0 && (
        <>
          <span className="dots" aria-hidden="true"><span /><span /><span /></span>
          <span><b>{names.slice(0, 2).join(', ')}</b>{names.length > 2 ? ` and ${names.length - 2} more` : ''} {names.length === 1 ? 'is' : 'are'} typing…</span>
        </>
      )}
    </div>
  );
}

function Composer({ channel, placeholder, wide }: { channel: string; placeholder: string; wide?: boolean }) {
  const [text, setText] = useState('');
  const ref = useRef<HTMLTextAreaElement>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [text]);

  const send = () => {
    if (!text.trim()) return;
    sendChat(channel, text);
    setText('');
  };

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      send();
    }
  };

  return (
    <form className={`composer${wide ? ' wide' : ''}`} onSubmit={(e) => { e.preventDefault(); send(); }}>
      <div className="box">
        <textarea
          ref={ref}
          rows={1}
          value={text}
          maxLength={2000}
          placeholder={placeholder}
          aria-label={placeholder}
          onChange={(e) => {
            setText(e.target.value);
            if (e.target.value) sendTyping(channel);
          }}
          onKeyDown={onKey}
        />
        <button type="submit" className={`ib${text.trim() ? ' on' : ''}`} title="Send" aria-label="Send" disabled={!text.trim()}>
          <SendIcon />
        </button>
      </div>
    </form>
  );
}

export function TextView() {
  const channel = useApp((s) => s.textChannel);
  const info = useApp((s) => s.channels.find((c) => c.id === s.textChannel));
  if (!info) return <div className="connecting">Loading…</div>;
  return (
    <section className="chat" aria-label={`#${info.name}`}>
      <header className="head">
        <span className="ic"><HashIcon /></span>
        <h1>{info.name}</h1>
        {info.topic && <><span className="sep" /><span className="topic">{info.topic}</span></>}
      </header>
      <Messages channel={channel} wide intro={{ name: info.name }} />
      <Typing channel={channel} />
      <Composer channel={channel} placeholder={`Message #${info.name}`} wide />
    </section>
  );
}

export function VoiceChatPanel() {
  const channel = useApp((s) => s.voiceChannel);
  const name = useApp((s) => s.channels.find((c) => c.id === s.voiceChannel)?.name ?? '');
  if (!channel) return null;
  return (
    <aside className="chat-side panel" aria-label={`${name} chat`}>
      <header className="head">
        <span className="ic"><ChatIcon size="s" /></span>
        <span className="titles">
          <span className="disp" style={{ fontWeight: 700 }}>{name} chat</span>
          <small>Saved on your server</small>
        </span>
        <button className="ib" title="Close chat" aria-label="Close chat" onClick={() => setApp({ chatOpen: false })}><CloseIcon /></button>
      </header>
      <Messages channel={channel} />
      <Typing channel={channel} />
      <Composer channel={channel} placeholder={`Message ${name}`} />
    </aside>
  );
}

export function MembersPanel() {
  const users = useApp((s) => s.users);
  const channels = useApp((s) => s.channels);
  const me = useApp((s) => s.me);
  return (
    <aside className="members-side panel" aria-label="Members">
      <div className="label">Online · {users.length}</div>
      <div className="scroll" style={{ flex: 1, minHeight: 0 }}>
        {users.map((u) => {
          const where = channels.find((c) => c.id === u.channel)?.name;
          return (
            <div key={u.id} className="person">
              <Avatar name={u.name} color={u.color} size={34} status />
              <span className="who">
                <b>{u.name}{u.id === me?.id ? ' (you)' : ''}</b>
                <small>{u.live ? `Streaming ${u.live.title}` : where ? `In ${where}` : 'Online'}</small>
              </span>
              {u.live && <span className="live-pill">LIVE</span>}
            </div>
          );
        })}
      </div>
    </aside>
  );
}
