import { useEffect, useState, type FormEvent } from 'react';
import { ApiError, adminApi, type Ban, type Channel } from '../lib/api';
import { changeServerPassword } from '../lib/actions';
import { updateSettings, useSettings } from '../lib/settings';
import { setApp, toast, useApp } from '../state/store';
import { Avatar } from './Avatar';
import { ChevronDownIcon, ChevronUpIcon, HashIcon, LockIcon, PlusIcon, SpeakerIcon, TrashIcon } from './Icons';

const errorText = (err: unknown) => (err instanceof ApiError ? err.message : 'Something went wrong. Try again.');

/** Runs an admin call. An expired unlock sends you back to the lock screen; other errors show a toast. */
async function run<T>(call: () => Promise<T>): Promise<T | undefined> {
  try {
    return await call();
  } catch (err) {
    if (err instanceof ApiError && err.code === 'admin_required') {
      updateSettings({ adminToken: null, adminExpiresAt: 0 });
      toast('Admin unlock expired. Unlock again.', 'warn');
    } else {
      toast(errorText(err), 'warn');
    }
    return undefined;
  }
}

/** A channel id the server accepts: a slug of the name plus a short random suffix. */
function newChannelId(name: string): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24) || 'channel';
  return `${slug}-${Math.random().toString(36).slice(2, 6)}`;
}

// ---------------- Locked ----------------

function Unlock() {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!password || busy) return;
    setBusy(true);
    setError('');
    try {
      const res = await adminApi.unlock(password);
      updateSettings({ adminToken: res.adminToken, adminExpiresAt: res.expiresAt });
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="card" onSubmit={(e) => void submit(e)}>
      <label className="label" htmlFor="admpw">Admin password</label>
      <div style={{ display: 'flex', gap: 10 }}>
        <input id="admpw" className="field" type="password" autoComplete="off" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus />
        <button className="btn-neon" disabled={!password || busy}>
          <LockIcon size="s" />
          Unlock
        </button>
      </div>
      {error && <div className="adm-error">{error}</div>}
      <div className="adm-hint">
        Only whoever runs the server has this. It's <code>ADMIN_PASSWORD</code> in the server's <code>.env</code> file. Stays unlocked on
        this device for 12 hours.
      </div>
    </form>
  );
}

// ---------------- Server ----------------

function ServerCard() {
  const serverName = useApp((s) => s.serverName);
  const [name, setName] = useState(serverName);
  const [password, setPassword] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => setName(serverName), [serverName]);

  const saveName = async () => {
    const n = name.trim();
    if (!n || n === serverName) return;
    if (await run(() => adminApi.updateServer({ serverName: n }))) toast('Server renamed');
  };

  const savePassword = async () => {
    setBusy(true);
    const ok = await run(async () => {
      await changeServerPassword(password);
      return true;
    });
    setBusy(false);
    if (!ok) return;
    setPassword('');
    setConfirming(false);
    toast('Password changed. Send your friends the new one.');
  };

  return (
    <div className="card">
      <span className="label">Server</span>
      <label className="adm-field-label" htmlFor="srvname">Server name</label>
      <div style={{ display: 'flex', gap: 10 }}>
        <input
          id="srvname"
          className="field"
          value={name}
          maxLength={40}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void saveName()}
        />
        <button className="btn-plain" disabled={!name.trim() || name.trim() === serverName} onClick={() => void saveName()}>
          Save
        </button>
      </div>

      <label className="adm-field-label" htmlFor="srvpw" style={{ marginTop: 18 }}>Friends' password</label>
      <div style={{ display: 'flex', gap: 10 }}>
        <input
          id="srvpw"
          className="field"
          type="text"
          autoComplete="off"
          spellCheck={false}
          placeholder="New password"
          value={password}
          maxLength={128}
          onChange={(e) => {
            setPassword(e.target.value);
            setConfirming(false);
          }}
        />
        <button className="btn-plain" disabled={password.length < 6} onClick={() => setConfirming(true)}>
          Change
        </button>
      </div>
      {confirming ? (
        <div className="adm-confirm">
          <span>Everyone gets signed out and needs the new password to get back in. You stay signed in.</span>
          <div className="adm-actions">
            <button className="btn-neon" disabled={busy} onClick={() => void savePassword()}>Change password</button>
            <button className="btn-ghost" onClick={() => setConfirming(false)}>Cancel</button>
          </div>
        </div>
      ) : (
        <div className="adm-hint">At least 6 characters. Changing it signs everyone else out, which is also how you lock out someone who got around a ban.</div>
      )}
    </div>
  );
}

// ---------------- Channels ----------------

function ChannelRows({
  kind,
  list,
  onChange,
}: {
  kind: Channel['kind'];
  list: Channel[];
  onChange: (next: Channel[]) => void;
}) {
  const users = useApp((s) => s.users);
  const group = list.filter((c) => c.kind === kind);
  const others = list.filter((c) => c.kind !== kind);
  const commit = (nextGroup: Channel[]) => onChange(kind === 'voice' ? [...nextGroup, ...others] : [...others, ...nextGroup]);
  const patch = (i: number, p: Partial<Channel>) => commit(group.map((c, j) => (j === i ? { ...c, ...p } : c)));
  const move = (i: number, by: number) => {
    const next = [...group];
    [next[i], next[i + by]] = [next[i + by]!, next[i]!];
    commit(next);
  };
  const add = () => {
    const name = kind === 'voice' ? 'New voice' : 'new-chat';
    commit([...group, { id: newChannelId(name), name, kind }]);
  };

  return (
    <div className="adm-list">
      {group.map((c, i) => {
        const here = users.filter((u) => u.channel === c.id).length;
        return (
          <div key={c.id} className="adm-row">
            <span className="kind">{kind === 'voice' ? <SpeakerIcon size="s" /> : <HashIcon size="s" />}</span>
            <div className="grow">
              <input className="field" aria-label="Channel name" value={c.name} maxLength={32} onChange={(e) => patch(i, { name: e.target.value })} />
              {kind === 'text' && (
                <input
                  className="field topic"
                  aria-label={`Topic for ${c.name}`}
                  placeholder="Topic (optional)"
                  value={c.topic ?? ''}
                  maxLength={120}
                  onChange={(e) => patch(i, { topic: e.target.value })}
                />
              )}
            </div>
            {here > 0 && <span className="chip neon" title="People in this channel now">{here} here</span>}
            <button className="ib" aria-label={`Move ${c.name} up`} disabled={i === 0} onClick={() => move(i, -1)}><ChevronUpIcon size="s" /></button>
            <button className="ib" aria-label={`Move ${c.name} down`} disabled={i === group.length - 1} onClick={() => move(i, 1)}><ChevronDownIcon size="s" /></button>
            <button
              className="ib bad"
              aria-label={`Delete ${c.name}`}
              title={group.length === 1 ? `Keep at least one ${kind} channel` : 'Delete'}
              disabled={group.length === 1}
              onClick={() => commit(group.filter((_, j) => j !== i))}
            >
              <TrashIcon size="s" />
            </button>
          </div>
        );
      })}
      <button className="btn-ghost adm-add" onClick={add}>
        <PlusIcon size="s" />
        {kind === 'voice' ? 'Add voice channel' : 'Add text channel'}
      </button>
    </div>
  );
}

function ChannelsCard() {
  const channels = useApp((s) => s.channels);
  // null while there are no edits, so changes from elsewhere show up live.
  const [draft, setDraft] = useState<Channel[] | null>(null);
  const [busy, setBusy] = useState(false);
  const list = draft ?? channels;
  const dirty = draft !== null && JSON.stringify(draft) !== JSON.stringify(channels);
  const valid = list.every((c) => c.name.trim().length > 0);

  const save = async () => {
    const clean = list.map(({ topic, ...c }) => {
      const t = topic?.trim();
      return { ...c, name: c.name.trim(), ...(c.kind === 'text' && t ? { topic: t } : {}) };
    });
    setBusy(true);
    const res = await run(() => adminApi.saveChannels(clean));
    setBusy(false);
    if (!res) return;
    setApp({ channels: res.channels });
    setDraft(null);
    toast('Channels saved');
  };

  return (
    <div className="card">
      <span className="label">Voice channels</span>
      <ChannelRows kind="voice" list={list} onChange={setDraft} />
      <div className="hr" style={{ margin: '14px 0' }} />
      <span className="label">Text channels</span>
      <ChannelRows kind="text" list={list} onChange={setDraft} />
      <div className="adm-actions" style={{ marginTop: 16 }}>
        <button className="btn-neon" disabled={!dirty || !valid || busy} onClick={() => void save()}>Save channels</button>
        {dirty && <button className="btn-ghost" onClick={() => setDraft(null)}>Discard</button>}
        {dirty && <span className="adm-hint" style={{ margin: 0 }}>{valid ? 'Unsaved changes' : 'Every channel needs a name'}</span>}
      </div>
      <div className="adm-hint">
        Renaming keeps a channel's chat history. Deleting a voice channel disconnects anyone in it. A deleted text channel's messages
        stay on the server, hidden.
      </div>
    </div>
  );
}

// ---------------- People ----------------

function PeopleCard() {
  const me = useApp((s) => s.me);
  const users = useApp((s) => s.users);
  const channels = useApp((s) => s.channels);
  const [banned, setBanned] = useState<Ban[]>([]);
  const [confirmBan, setConfirmBan] = useState<string | null>(null);

  useEffect(() => {
    void run(() => adminApi.state()).then((s) => s && setBanned(s.banned));
  }, []);

  const kick = async (id: string, name: string) => {
    if (await run(() => adminApi.kick(id))) toast(`${name} was removed. They can sign back in with the password.`);
  };
  const ban = async (id: string, name: string) => {
    const res = await run(() => adminApi.ban(id, name));
    setConfirmBan(null);
    if (res) {
      setBanned(res.banned);
      toast(`${name} is banned`);
    }
  };
  const unban = async (id: string) => {
    const res = await run(() => adminApi.unban(id));
    if (res) setBanned(res.banned);
  };

  const where = (channel: string | null) => {
    const c = channels.find((x) => x.id === channel);
    return c ? `In ${c.name}` : 'Online';
  };

  return (
    <div className="card">
      <span className="label">Online now · {users.length}</span>
      <div className="adm-list">
        {users.map((u) => (
          <div key={u.id} className="adm-row">
            <Avatar id={u.id} name={u.name} color={u.color} size={32} />
            <div className="grow who">
              <b>{u.name}</b>
              <small>{where(u.channel)}</small>
            </div>
            {u.id === me?.id ? (
              <span className="adm-you">You</span>
            ) : confirmBan === u.id ? (
              <>
                <span className="adm-hint" style={{ margin: 0 }}>Ban {u.name}?</span>
                <button className="btn-plain sm danger" onClick={() => void ban(u.id, u.name)}>Ban</button>
                <button className="btn-ghost sm" onClick={() => setConfirmBan(null)}>Cancel</button>
              </>
            ) : (
              <>
                <button className="btn-plain sm" onClick={() => void kick(u.id, u.name)}>Kick</button>
                <button className="btn-plain sm danger" onClick={() => setConfirmBan(u.id)}>Ban</button>
              </>
            )}
          </div>
        ))}
      </div>
      <div className="adm-hint">Kick signs someone out; they can come back with the password. Ban blocks their device until you unban it.</div>

      {banned.length > 0 && (
        <>
          <div className="hr" style={{ margin: '14px 0' }} />
          <span className="label">Banned · {banned.length}</span>
          <div className="adm-list">
            {banned.map((b) => (
              <div key={b.id} className="adm-row">
                <Avatar name={b.name} color="#3a3f49" size={32} />
                <div className="grow who">
                  <b>{b.name}</b>
                  <small>Banned {new Date(b.at).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}</small>
                </div>
                <button className="btn-plain sm" onClick={() => void unban(b.id)}>Unban</button>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ---------------- Section ----------------

export function AdminSettings() {
  const token = useSettings((s) => s.adminToken);
  const expiresAt = useSettings((s) => s.adminExpiresAt);
  const unlocked = Boolean(token) && expiresAt > Date.now();

  return (
    <>
      <h1>Server admin</h1>
      <p className="lead">Channels, the server name and password, and who's allowed in. Changes reach everyone straight away.</p>
      {unlocked ? (
        <>
          <ChannelsCard />
          <PeopleCard />
          <ServerCard />
          <button className="btn-plain" onClick={() => updateSettings({ adminToken: null, adminExpiresAt: 0 })}>
            <LockIcon size="s" />
            Lock admin
          </button>
        </>
      ) : (
        <Unlock />
      )}
    </>
  );
}
