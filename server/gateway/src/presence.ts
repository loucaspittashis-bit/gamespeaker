export type LiveInfo = { title: string; quality: string };
export type Status = 'online' | 'idle' | 'dnd';
export type CustomStatus = { emoji: string; text: string };

export type UserState = {
  id: string;
  name: string;
  color: string;
  channel: string | null; // voice channel id, or null when not in voice
  muted: boolean;
  deafened: boolean;
  live: LiveInfo | null;
  /** The game they have open, if they share it. */
  playing: string | null;
  status: Status;
  custom: CustomStatus | null;
  /** Whose stream they have on screen. */
  watching: string | null;
  since: number; // when they joined their current voice channel
};

export type StatePatch = Partial<
  Pick<UserState, 'name' | 'color' | 'channel' | 'muted' | 'deafened' | 'live' | 'playing' | 'status' | 'custom' | 'watching'>
>;

// Who is online, which voice channel they're in, muted/deafened/live.
// A user can have several connections (desktop + phone); they stay online
// until the last one closes.
export class Presence {
  private users = new Map<string, UserState & { conns: number }>();

  connect(user: { id: string; name: string; color: string }): void {
    const existing = this.users.get(user.id);
    if (existing) {
      existing.conns += 1;
      existing.name = user.name;
      existing.color = user.color;
      return;
    }
    this.users.set(user.id, {
      ...user,
      channel: null, muted: false, deafened: false, live: null, playing: null,
      status: 'online', custom: null, watching: null, since: Date.now(), conns: 1,
    });
  }

  /** Returns true if the user went fully offline. */
  disconnect(id: string): boolean {
    const user = this.users.get(id);
    if (!user) return false;
    user.conns -= 1;
    if (user.conns > 0) return false;
    this.users.delete(id);
    return true;
  }

  update(id: string, patch: StatePatch): boolean {
    const user = this.users.get(id);
    if (!user) return false;
    if (patch.channel !== undefined && patch.channel !== user.channel) user.since = Date.now();
    Object.assign(user, patch);
    if (user.channel === null) {
      user.live = null;
      user.watching = null;
    }
    return true;
  }

  list(): UserState[] {
    return [...this.users.values()]
      .map(({ conns: _conns, ...state }) => state)
      .sort((a, b) => a.since - b.since);
  }
}
