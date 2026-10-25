import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ClipboardEvent, type DragEvent, type KeyboardEvent } from 'react';
import { useApp, setApp, toast } from '../state/store';
import { ApiError, MAX_ATTACHMENTS, api, mediaUrl, type Attachment } from '../lib/api';
import { discardPending, isChannelVisible, loadOlder, markRead, retryPending, sendChat, sendTyping } from '../lib/actions';
import { formatTime, linkify } from '../lib/format';
import { prepareImage } from '../lib/images';
import { mentionQuery, mentionsMe, splitMentions } from '../lib/mentions';
import { Avatar } from './Avatar';
import { openProfile } from './ProfileCard';
import { STATUS_LABEL } from './StatusEditor';
import { ChatIcon, CloseIcon, HashIcon, ImageIcon, SendIcon, SpeakerIcon } from './Icons';

const GROUP_MS = 5 * 60 * 1000;

function useNow(intervalMs: number): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(t);
  }, [intervalMs]);
  return now;
}

/** Names you can @mention: everyone online plus whoever has posted here. */
function useMentionNames(channel: string): string[] {
  const users = useApp((s) => s.users);
  const messages = useApp((s) => s.messages[channel]);
  return useMemo(() => {
    const names = new Set(users.map((u) => u.name));
    for (const m of (messages ?? []).slice(-200)) names.add(m.name);
    return [...names];
  }, [users, messages]);
}

function Text({ text, names }: { text: string; names: string[] }) {
  return (
    <>
      {splitMentions(text, names).map((part, i) =>
        part.mention ? (
          <span key={i} className="mention">{part.text}</span>
        ) : (
          linkify(part.text).map((p, j) =>
            p.href ? <a key={`${i}.${j}`} href={p.href} target="_blank" rel="noreferrer">{p.text}</a> : <span key={`${i}.${j}`}>{p.text}</span>,
          )
        ),
      )}
    </>
  );
}

/** Chat pictures, sized from their stored dimensions so the chat doesn't jump while they load. */
function Pictures({ items, wide }: { items: Attachment[]; wide?: boolean }) {
  if (!items.length) return null;
  const single = items.length === 1;
  const maxW = single ? (wide ? 420 : 300) : wide ? 220 : 160;
  const maxH = single ? 320 : 200;
  return (
    <div className={`pics${single ? ' one' : ''}`}>
      {items.map((a) => {
        const scale = Math.min(1, maxW / a.width, maxH / a.height);
        const url = mediaUrl(a.file);
        return (
          <button key={a.file} className="pic" aria-label="Open picture" onClick={() => setApp({ lightbox: url })}>
            <img src={url} alt="" loading="lazy" decoding="async" width={Math.round(a.width * scale)} height={Math.round(a.height * scale)} />
          </button>
        );
      })}
    </div>
  );
}

function Messages({ channel, wide, intro }: { channel: string; wide?: boolean; intro?: { name: string } }) {
  const messages = useApp((s) => s.messages[channel]);
  const pendingAll = useApp((s) => s.pending);
  const hasMore = useApp((s) => s.hasMore[channel] ?? false);
  const loaded = useApp((s) => s.historyLoaded[channel] ?? false);
  const me = useApp((s) => s.me);
  const names = useMentionNames(channel);
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
      onDragOver={(e) => e.dataTransfer.types.includes('Files') && e.preventDefault()}
      onDrop={(e) => dropFiles(e, channel)}
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
          <div key={m.id} className={`msg${cont ? ' cont' : ''}${me && m.userId !== me.id && mentionsMe(m.text, me.name) ? ' mentioned' : ''}`}>
            <button className="msg-av" aria-label={`${m.name}'s profile`} onClick={(e) => openProfile(e, m.userId, { name: m.name, color: m.color })}>
              <Avatar id={m.userId} name={m.name} color={m.color} size={wide ? 40 : 34} />
            </button>
            <div className="body">
              {!cont && (
                <div className="meta">
                  <button className="msg-name" style={{ color: m.color }} onClick={(e) => openProfile(e, m.userId, { name: m.name, color: m.color })}>{m.name}</button>
                  <time dateTime={new Date(m.ts).toISOString()}>{formatTime(m.ts)}</time>
                </div>
              )}
              {m.text && <div className="text"><Text text={m.text} names={names} /></div>}
              <Pictures items={m.attachments ?? []} wide={wide} />
            </div>
          </div>
        );
      })}
      {pending.map((p) => (
        <div key={p.nonce} className={`msg ${p.failed ? 'failed' : 'pending'}`}>
          <Avatar id={me?.id} name={me?.name ?? '?'} color={me?.color ?? '#888'} size={wide ? 40 : 34} />
          <div className="body">
            <div className="meta"><b style={{ color: me?.color }}>{me?.name}</b><time>{p.failed ? 'not sent' : 'sending…'}</time></div>
            {p.text && <div className="text">{p.text}</div>}
            <Pictures items={p.attachments} wide={wide} />
            {p.failed && (
              <span className="retry-row">
                <button className="retry" onClick={() => retryPending(p.nonce)}>Try again</button>
                <button className="retry" onClick={() => discardPending(p.nonce)}>Delete</button>
              </span>
            )}
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

type Draft = { id: string; preview: string; status: 'uploading' | 'done' | 'error'; att?: Attachment };

/** Pictures dropped on the messages go to that channel's composer. */
function dropFiles(e: DragEvent, channel: string): void {
  const files = [...e.dataTransfer.files].filter((f) => f.type.startsWith('image/'));
  if (!files.length) return;
  e.preventDefault();
  window.dispatchEvent(new CustomEvent('gs-attach', { detail: { channel, files } }));
}

function MentionMenu({ names, query, active, onPick }: { names: string[]; query: string; active: number; onPick: (n: string) => void }) {
  const users = useApp((s) => s.users);
  return (
    <div className="mention-menu" role="listbox" aria-label="Mention someone">
      {names.map((n, i) => {
        const u = users.find((x) => x.name === n);
        return (
          <button
            key={n}
            role="option"
            aria-selected={i === active}
            className={i === active ? 'on' : ''}
            onMouseDown={(e) => {
              e.preventDefault();
              onPick(n);
            }}
          >
            {n === 'everyone' ? <span className="everyone">@</span> : <Avatar id={u?.id} name={n} color={u?.color ?? '#8b919d'} size={26} noFrame />}
            <b>{n}</b>
            {n === 'everyone' && <small>Notify everyone here</small>}
          </button>
        );
      })}
      {names.length === 0 && <div className="none">Nobody called “{query}”</div>}
    </div>
  );
}

/** Half-typed messages, per channel, so switching channels keeps each one where it was typed. */
const textDrafts = new Map<string, string>();

function Composer({ channel, placeholder, wide }: { channel: string; placeholder: string; wide?: boolean }) {
  const [text, setText] = useState(() => textDrafts.get(channel) ?? '');
  useEffect(() => {
    if (text) textDrafts.set(channel, text);
    else textDrafts.delete(channel);
  }, [channel, text]);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [caret, setCaret] = useState(0);
  const [active, setActive] = useState(0);
  const [menuClosed, setMenuClosed] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const names = useMentionNames(channel);
  const myName = useApp((s) => s.me?.name);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [text]);

  // Free the local previews when they're gone.
  const previews = useRef(new Set<string>());
  useEffect(() => () => previews.current.forEach((u) => URL.revokeObjectURL(u)), []);

  const addFiles = (files: File[]) => {
    const room = MAX_ATTACHMENTS - drafts.length;
    if (files.length > room) toast(`Up to ${MAX_ATTACHMENTS} pictures per message`, 'warn');
    for (const file of files.slice(0, Math.max(0, room))) {
      const id = crypto.randomUUID();
      const preview = URL.createObjectURL(file);
      previews.current.add(preview);
      setDrafts((d) => [...d, { id, preview, status: 'uploading' }]);
      void prepareImage(file)
        .then((blob) => api.uploadChatImage(blob))
        .then((att) => setDrafts((d) => d.map((x) => (x.id === id ? { ...x, status: 'done', att } : x))))
        .catch((err: unknown) => {
          toast(err instanceof ApiError || err instanceof Error ? err.message : 'Upload failed', 'warn');
          setDrafts((d) => d.map((x) => (x.id === id ? { ...x, status: 'error' } : x)));
        });
    }
  };

  useEffect(() => {
    const onAttach = (e: Event) => {
      const { channel: target, files } = (e as CustomEvent<{ channel: string; files: File[] }>).detail;
      if (target === channel) addFiles(files);
    };
    window.addEventListener('gs-attach', onAttach);
    return () => window.removeEventListener('gs-attach', onAttach);
  });

  const removeDraft = (id: string) => setDrafts((d) => d.filter((x) => x.id !== id));
  const uploading = drafts.some((d) => d.status === 'uploading');
  const ready = drafts.flatMap((d) => (d.status === 'done' && d.att ? [d.att] : []));
  const canSend = !uploading && (text.trim().length > 0 || ready.length > 0);

  // @mention suggestions for the word being typed.
  const q = menuClosed ? null : mentionQuery(text, caret);
  const matches = q
    ? ['everyone', ...names.filter((n) => n !== myName)].filter((n) => n.toLowerCase().startsWith(q.query.toLowerCase())).slice(0, 6)
    : [];

  const pick = (name: string) => {
    if (!q) return;
    const next = `${text.slice(0, q.start)}@${name} ${text.slice(caret)}`;
    const pos = q.start + name.length + 2;
    setText(next);
    setActive(0);
    requestAnimationFrame(() => {
      ref.current?.setSelectionRange(pos, pos);
      setCaret(pos);
    });
  };

  const send = () => {
    if (!canSend) return;
    sendChat(channel, text, ready);
    setText('');
    setDrafts([]);
  };

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (q && matches.length) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        setActive((a) => (a + (e.key === 'ArrowDown' ? 1 : matches.length - 1)) % matches.length);
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        pick(matches[Math.min(active, matches.length - 1)]!);
        return;
      }
      if (e.key === 'Escape') {
        e.stopPropagation();
        setMenuClosed(true);
        return;
      }
    }
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      send();
    }
  };

  const onPaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const files = [...e.clipboardData.files].filter((f) => f.type.startsWith('image/'));
    if (!files.length) return;
    e.preventDefault();
    addFiles(files);
  };

  return (
    <form
      className={`composer${wide ? ' wide' : ''}`}
      onSubmit={(e) => { e.preventDefault(); send(); }}
      onDragOver={(e) => e.dataTransfer.types.includes('Files') && e.preventDefault()}
      onDrop={(e) => dropFiles(e, channel)}
    >
      {q && <MentionMenu names={matches} query={q.query} active={Math.min(active, Math.max(0, matches.length - 1))} onPick={pick} />}
      {drafts.length > 0 && (
        <div className="drafts">
          {drafts.map((d) => (
            <span key={d.id} className={`draft ${d.status}`}>
              <img src={d.preview} alt="" />
              {d.status === 'uploading' && <span className="spin" aria-label="Uploading" />}
              <button type="button" aria-label="Remove picture" onClick={() => removeDraft(d.id)}><CloseIcon size="xs" /></button>
            </span>
          ))}
        </div>
      )}
      <div className="box">
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          multiple
          hidden
          onChange={(e) => {
            addFiles([...(e.target.files ?? [])]);
            e.target.value = '';
          }}
        />
        <button type="button" className="ib attach" title="Add pictures" aria-label="Add pictures" onClick={() => fileRef.current?.click()}>
          <ImageIcon />
        </button>
        <textarea
          ref={ref}
          rows={1}
          value={text}
          maxLength={2000}
          placeholder={placeholder}
          aria-label={placeholder}
          onChange={(e) => {
            setText(e.target.value);
            setCaret(e.target.selectionStart);
            setMenuClosed(false);
            setActive(0);
            if (e.target.value) sendTyping(channel);
          }}
          onSelect={(e) => setCaret(e.currentTarget.selectionStart)}
          onKeyDown={onKey}
          onPaste={onPaste}
          onBlur={() => setMenuClosed(true)}
          onFocus={() => setMenuClosed(false)}
        />
        <button type="submit" className={`ib${canSend ? ' on' : ''}`} title="Send" aria-label="Send" disabled={!canSend}>
          <SendIcon />
        </button>
      </div>
    </form>
  );
}

export function TextView() {
  const channel = useApp((s) => s.textChannel);
  const info = useApp((s) => s.channels.find((c) => c.id === s.textChannel));
  const voice = useApp((s) => s.channels.find((c) => c.id === s.voiceChannel));
  if (!info) return <div className="connecting">Loading…</div>;
  return (
    <section className="chat" aria-label={`#${info.name}`}>
      <header className="head">
        <span className="ic"><HashIcon /></span>
        <h1>{info.name}</h1>
        {info.topic && <><span className="sep" /><span className="topic">{info.topic}</span></>}
      </header>
      {/* Still in voice while reading a text channel: make the way back obvious. */}
      {voice && (
        <button className="back-to-voice" onClick={() => setApp({ view: 'voice' })}>
          <SpeakerIcon size="s" />
          <span>You're in <b>{voice.name}</b></span>
          <span className="go">Back to voice →</span>
        </button>
      )}
      <Messages key={channel} channel={channel} wide intro={{ name: info.name }} />
      <Typing channel={channel} />
      <Composer key={channel} channel={channel} placeholder={`Message #${info.name}`} wide />
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
          <span className="disp" style={{ fontWeight: 700 }}>{name} · voice chat</span>
          <small title={`Everyone in ${name} sees this · saved on your server`}>Everyone in {name} sees this · saved on your server</small>
        </span>
        <button className="ib" title="Close chat" aria-label="Close chat" onClick={() => setApp({ chatOpen: false })}><CloseIcon /></button>
      </header>
      <Messages key={channel} channel={channel} />
      <Typing channel={channel} />
      <Composer key={channel} channel={channel} placeholder={`Message ${name}`} />
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
            <button key={u.id} className="person hv" onClick={(e) => openProfile(e, u.id)}>
              <Avatar id={u.id} name={u.name} color={u.color} size={34} status={u.status ?? 'online'} />
              <span className="who">
                <b>{u.name}{u.id === me?.id ? ' (you)' : ''}</b>
                <small>
                  {u.live
                    ? `Streaming ${u.live.title}`
                    : u.custom
                      ? `${u.custom.emoji} ${u.custom.text}`.trim()
                      : u.playing
                        ? `Playing ${u.playing}`
                        : where
                          ? `In ${where}`
                          : STATUS_LABEL[u.status ?? 'online']}
                </small>
              </span>
              {u.live && <span className="live-pill">LIVE</span>}
            </button>
          );
        })}
      </div>
    </aside>
  );
}
