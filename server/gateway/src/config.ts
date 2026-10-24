export type ChannelKind = 'voice' | 'text';

export type Channel = {
  id: string;
  name: string;
  kind: ChannelKind;
  topic?: string;
};

export type Config = {
  host: string;
  port: number;
  dataDir: string;
  serverName: string;
  serverPassword: string;
  /** Unlocks the admin screen. null = admin disabled. */
  adminPassword: string | null;
  sessionSecret: string;
  livekitUrl: string;
  /** How the gateway reaches LiveKit's server API (kick, close rooms). */
  livekitHost: string;
  livekitApiKey: string;
  livekitApiSecret: string;
  channels: Channel[];
};

export const DEFAULT_CHANNELS: Channel[] = [
  { id: 'lobby', name: 'Lobby', kind: 'voice' },
  { id: 'gaming', name: 'Gaming', kind: 'voice' },
  { id: 'movie', name: 'Movie Night', kind: 'voice' },
  { id: 'afk', name: 'AFK', kind: 'voice' },
  { id: 'general', name: 'general', kind: 'text', topic: 'Hang out. Chat history is kept on our server.' },
  { id: 'clips', name: 'clips', kind: 'text', topic: 'Drop your best plays.' },
  { id: 'memes', name: 'memes', kind: 'text', topic: 'Self-explanatory.' },
];

export const CHANNEL_ID = /^[a-z0-9][a-z0-9-]{0,31}$/;
export const MAX_CHANNELS = 30;

/** Checks a channel list (from env or the admin screen). Throws a readable Error. */
export function validateChannels(input: unknown): Channel[] {
  if (!Array.isArray(input) || input.length === 0) throw new Error('Add at least one channel.');
  if (input.length > MAX_CHANNELS) throw new Error(`At most ${MAX_CHANNELS} channels.`);
  const seen = new Set<string>();
  const channels = input.map((raw: unknown) => {
    const c = (raw ?? {}) as Partial<Channel>;
    if (typeof c.id !== 'string' || !CHANNEL_ID.test(c.id)) throw new Error(`Invalid channel id ${JSON.stringify(c.id)}.`);
    if (seen.has(c.id)) throw new Error(`Two channels share the id "${c.id}".`);
    if (c.kind !== 'voice' && c.kind !== 'text') throw new Error(`Channel "${c.id}" must be voice or text.`);
    const name = String(c.name ?? '').replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim();
    if (name.length < 1 || name.length > 32) throw new Error('Channel names must be 1 to 32 characters.');
    const topic = typeof c.topic === 'string' ? c.topic.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 120) : '';
    seen.add(c.id);
    return { id: c.id, name, kind: c.kind, ...(topic && c.kind === 'text' ? { topic } : {}) };
  });
  if (!channels.some((c) => c.kind === 'voice')) throw new Error('Keep at least one voice channel.');
  if (!channels.some((c) => c.kind === 'text')) throw new Error('Keep at least one text channel.');
  return channels;
}

function parseChannels(raw: string | undefined): Channel[] {
  if (!raw) return DEFAULT_CHANNELS;
  try {
    return validateChannels(JSON.parse(raw));
  } catch (err) {
    throw new Error(`CHANNELS: ${err instanceof Error ? err.message : err}`);
  }
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const missing = ['SERVER_PASSWORD', 'SESSION_SECRET', 'LIVEKIT_URL', 'LIVEKIT_API_KEY', 'LIVEKIT_API_SECRET']
    .filter((k) => !env[k]);
  if (missing.length) throw new Error(`Missing required environment variables: ${missing.join(', ')}`);

  const sessionSecret = env.SESSION_SECRET!;
  if (sessionSecret.length < 32) throw new Error('SESSION_SECRET must be at least 32 characters');
  const adminPassword = env.ADMIN_PASSWORD || null;
  if (adminPassword && adminPassword.length < 8) throw new Error('ADMIN_PASSWORD must be at least 8 characters');

  return {
    host: env.HOST ?? '127.0.0.1',
    port: Number(env.PORT ?? 3000),
    dataDir: env.DATA_DIR ?? './data',
    serverName: env.SERVER_NAME ?? 'Gamespeaker',
    serverPassword: env.SERVER_PASSWORD!,
    adminPassword,
    sessionSecret,
    livekitUrl: env.LIVEKIT_URL!,
    livekitHost: env.LIVEKIT_HOST ?? 'http://127.0.0.1:7880',
    livekitApiKey: env.LIVEKIT_API_KEY!,
    livekitApiSecret: env.LIVEKIT_API_SECRET!,
    channels: parseChannels(env.CHANNELS),
  };
}
