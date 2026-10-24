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
  sessionSecret: string;
  livekitUrl: string;
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

const CHANNEL_ID = /^[a-z0-9][a-z0-9-]{0,31}$/;

function parseChannels(raw: string | undefined): Channel[] {
  if (!raw) return DEFAULT_CHANNELS;
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed) || parsed.length === 0) throw new Error('CHANNELS must be a non-empty JSON array');
  const seen = new Set<string>();
  return parsed.map((c: Partial<Channel>) => {
    if (!c.id || !CHANNEL_ID.test(c.id)) throw new Error(`CHANNELS: invalid id ${JSON.stringify(c.id)}`);
    if (seen.has(c.id)) throw new Error(`CHANNELS: duplicate id ${c.id}`);
    if (c.kind !== 'voice' && c.kind !== 'text') throw new Error(`CHANNELS: ${c.id} needs kind "voice" or "text"`);
    seen.add(c.id);
    return { id: c.id, name: String(c.name ?? c.id), kind: c.kind, ...(c.topic ? { topic: String(c.topic) } : {}) };
  });
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const missing = ['SERVER_PASSWORD', 'SESSION_SECRET', 'LIVEKIT_URL', 'LIVEKIT_API_KEY', 'LIVEKIT_API_SECRET']
    .filter((k) => !env[k]);
  if (missing.length) throw new Error(`Missing required environment variables: ${missing.join(', ')}`);

  const sessionSecret = env.SESSION_SECRET!;
  if (sessionSecret.length < 32) throw new Error('SESSION_SECRET must be at least 32 characters');

  return {
    host: env.HOST ?? '127.0.0.1',
    port: Number(env.PORT ?? 3000),
    dataDir: env.DATA_DIR ?? './data',
    serverName: env.SERVER_NAME ?? 'Gamespeaker',
    serverPassword: env.SERVER_PASSWORD!,
    sessionSecret,
    livekitUrl: env.LIVEKIT_URL!,
    livekitApiKey: env.LIVEKIT_API_KEY!,
    livekitApiSecret: env.LIVEKIT_API_SECRET!,
    channels: parseChannels(env.CHANNELS),
  };
}
