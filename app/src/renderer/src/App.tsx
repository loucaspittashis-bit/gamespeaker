import { useEffect } from 'react';
import { useApp, setApp, toast } from './state/store';
import { startSession } from './lib/actions';
import { bridge, isDesktop, isMac } from './lib/platform';
import { settings, useSettings } from './lib/settings';
import { applyTheme } from './lib/theme';
import { setDeafened, setMuted } from './lib/voice';
import { Sidebar } from './components/Sidebar';
import { VoiceView } from './components/VoiceView';
import { MembersPanel, TextView, VoiceChatPanel } from './components/Chat';
import { ContextMenu } from './components/ContextMenu';
import { closeProfile, ProfilePopover } from './components/ProfileCard';
import { GoLiveModal } from './components/GoLive';
import { SettingsModal } from './components/Settings';
import { Welcome } from './components/Welcome';
import { UpdateScreen } from './components/UpdateScreen';

function Toasts() {
  const toasts = useApp((s) => s.toasts);
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast glass${t.tone === 'warn' ? ' warn' : ''}`} role="status"><i />{t.text}</div>
      ))}
    </div>
  );
}

function Lightbox() {
  const url = useApp((s) => s.lightbox);
  if (!url) return null;
  const close = () => setApp({ lightbox: null });
  return (
    <div className="lightbox" role="dialog" aria-modal="true" aria-label="Picture" onClick={close}>
      <img src={url} alt="" onClick={(e) => e.stopPropagation()} />
      <div className="lb-bar" onClick={(e) => e.stopPropagation()}>
        <a className="btn-plain" href={url} target="_blank" rel="noreferrer">Open original</a>
        <button className="btn-plain" onClick={close}>Close</button>
      </div>
    </div>
  );
}

function TitleBar() {
  const update = useApp((s) => s.update);
  if (!isDesktop) return null;
  return (
    <div className={`titlebar${isMac ? ' mac' : ''}`}>
      <span>Gamecoms</span>
      {update.state === 'ready' && (
        <button className="update-pill" onClick={() => void bridge?.installUpdate()}>Update ready · Restart</button>
      )}
    </div>
  );
}

function Shell() {
  const view = useApp((s) => s.view);
  const voiceChannel = useApp((s) => s.voiceChannel);
  const chatOpen = useApp((s) => s.chatOpen);
  const fullscreen = useApp((s) => s.fullscreen);
  const modal = useApp((s) => s.modal);
  const gatewayStatus = useApp((s) => s.gatewayStatus);
  const inVoiceView = view === 'voice' && Boolean(voiceChannel);

  return (
    <div className={`frame${isDesktop ? '' : ' web'}`}>
      <TitleBar />
      <div className="app">
        {!(fullscreen && inVoiceView) && <Sidebar />}
        <main className="main panel">
          {gatewayStatus === 'offline' && <span className="chip warn offline-bar">Reconnecting to the server…</span>}
          {inVoiceView ? <VoiceView /> : <TextView />}
        </main>
        {inVoiceView && chatOpen && !fullscreen && <VoiceChatPanel />}
        {!inVoiceView && <MembersPanel />}
      </div>
      <ContextMenu />
      <ProfilePopover />
      <Lightbox />
      {modal === 'golive' && <GoLiveModal />}
      {modal === 'settings' && <SettingsModal />}
    </div>
  );
}

/** Opened this recently: restarting for an update costs nothing yet. */
const JUST_OPENED_MS = 3 * 60 * 1000;
/** Hidden in the tray or minimized for this long counts as not in use. */
const AWAY_MS = 2 * 60 * 1000;

/**
 * Installs a downloaded update by itself when that interrupts nothing: never
 * in voice or while streaming, and only right after opening the app, or while
 * it's in the background or you're away. Otherwise "Update ready" waits at the top.
 */
function useAutoInstall(): void {
  const ready = useApp((s) => s.update.state === 'ready');
  useEffect(() => {
    if (!ready || !bridge) return;
    let hiddenSince = document.hidden ? Date.now() : 0;
    const onVisibility = () => (hiddenSince = document.hidden ? Date.now() : 0);
    const tick = () => {
      const s = useApp.getState();
      if (s.voiceChannel || s.myLive || s.updateScreen) return;
      const justOpened = performance.now() < JUST_OPENED_MS;
      const away = s.idle || (hiddenSince > 0 && Date.now() - hiddenSince >= AWAY_MS);
      if (justOpened || away) setApp({ updateScreen: 'restarting' });
    };
    document.addEventListener('visibilitychange', onVisibility);
    const timer = setInterval(tick, 10_000);
    tick();
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [ready]);
}

export function App() {
  const phase = useApp((s) => s.phase);
  const neon = useSettings((s) => s.neon);
  const glow = useSettings((s) => s.glow);

  useEffect(() => applyTheme(neon, glow), [neon, glow]);

  useEffect(() => {
    if (settings().session) startSession();
    void bridge?.setCloseTo(settings().closeTo);
    const offUpdate = bridge?.onUpdateStatus((update) => {
      if (update.state === 'ready' && useApp.getState().update.state !== 'ready') {
        toast(`Version ${update.version} is ready. It installs itself once you're out of voice and away, or click "Update ready" at the top.`);
      }
      setApp({ update });
    });

    const onKey = (e: KeyboardEvent) => {
      const s = useApp.getState();
      if (e.key === 'Escape') {
        if (s.lightbox) return setApp({ lightbox: null });
        if (closeProfile()) return;
        if (s.ctxMenu || s.popover) setApp({ ctxMenu: null, popover: null });
        else if (s.modal) setApp({ modal: null });
        else if (s.fullscreen) setApp({ fullscreen: false });
        return;
      }
      if (s.phase !== 'ready' || !(e.ctrlKey || e.metaKey) || !e.shiftKey) return;
      if (e.code === 'KeyM') {
        e.preventDefault();
        setMuted(!(s.muted || s.deafened));
      } else if (e.code === 'KeyD') {
        e.preventDefault();
        setDeafened(!s.deafened);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      offUpdate?.();
    };
  }, []);

  useAutoInstall();

  return (
    <>
      {phase === 'welcome' ? <Welcome /> : <Shell />}
      <UpdateScreen />
      <Toasts />
    </>
  );
}
