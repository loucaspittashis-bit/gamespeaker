import { useState } from 'react';
import { streamGame } from '../lib/games';
import { stopStream } from '../lib/voice';
import { setApp, useApp } from '../state/store';
import { ChevronDownIcon, EyeIcon, ScreenIcon } from './Icons';

/**
 * Go Live in the sidebar ("side") and the voice dock ("dock"). When a game is
 * open it becomes "Stream <game>", one click with your saved quality, plus a
 * small button for the full picker.
 */
export function GoLiveButton({ variant }: { variant: 'side' | 'dock' }) {
  const myLive = useApp((s) => s.myLive);
  const game = useApp((s) => s.game);
  const connected = useApp((s) => s.voiceStatus === 'connected');
  const myId = useApp((s) => s.me?.id);
  const users = useApp((s) => s.users);
  const watching = users.filter((u) => u.watching === myId && u.id !== myId).length;
  const [starting, setStarting] = useState(false);
  const cls = variant === 'side' ? 'live-btn' : 'go';
  // The sidebar button waits for voice to connect; the dock only shows once connected anyway.
  const blocked = variant === 'side' && !connected;
  const openPicker = () => setApp({ modal: 'golive', popover: null });

  if (myLive) {
    return (
      <button
        className={`${cls} on`}
        title={watching ? users.filter((u) => u.watching === myId).map((u) => u.name).join(', ') + ' watching' : 'Nobody watching yet'}
        onClick={() => void stopStream()}
      >
        <ScreenIcon size={variant === 'side' ? 's' : undefined} />
        End stream
        <span className="watch-count"><EyeIcon size="xs" />{watching}</span>
      </button>
    );
  }
  if (!game) {
    return (
      <button className={cls} disabled={blocked} onClick={openPicker}>
        <ScreenIcon size={variant === 'side' ? 's' : undefined} />
        Go Live
      </button>
    );
  }
  return (
    <span className={`golive-split gl-${variant}`}>
      <button
        className={`${cls} game`}
        disabled={blocked || starting}
        title={`Stream ${game.name} now`}
        onClick={async () => {
          setStarting(true);
          await streamGame(game);
          setStarting(false);
        }}
      >
        <ScreenIcon size={variant === 'side' ? 's' : undefined} />
        <span className="gname">{starting ? 'Starting…' : `Stream ${game.name}`}</span>
      </button>
      <button className={`${cls} more`} disabled={blocked} title="Choose something else to stream" aria-label="Choose something else to stream" onClick={openPicker}>
        <ChevronDownIcon size="s" />
      </button>
    </span>
  );
}
