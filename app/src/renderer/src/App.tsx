import { useEffect } from 'react';
import { useApp, setApp } from './state/store';
import { startSession } from './lib/actions';
import { bridge, isDesktop, isMac } from './lib/platform';
import { settings, useSettings } from './lib/settings';
import { applyTheme } from './lib/theme';
import { setDeafened, setMuted } from './lib/voice';
import { Sidebar } from './components/Sidebar';
import { VoiceView } from './components/VoiceView';
import { MembersPanel, TextView, VoiceChatPanel } from './components/Chat';
import { ContextMenu } from './components/ContextMenu';
import { GoLiveModal } from './components/GoLive';
import { SettingsModal } from './components/Settings';
import { Welcome } from './components/Welcome';

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

function TitleBar() {
  const update = useApp((s) => s.update);
  if (!isDesktop) return null;
  return (
    <div className={`titlebar${isMac ? ' mac' : ''}`}>
      <span>Gamespeaker</span>
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
      {modal === 'golive' && <GoLiveModal />}
      {modal === 'settings' && <SettingsModal />}
    </div>
  );
}

export function App() {
  const phase = useApp((s) => s.phase);
  const neon = useSettings((s) => s.neon);
  const glow = useSettings((s) => s.glow);

  useEffect(() => applyTheme(neon, glow), [neon, glow]);

  useEffect(() => {
    if (settings().session) startSession();
    void bridge?.setCloseToTray(settings().closeToTray);
    const offUpdate = bridge?.onUpdateStatus((update) => setApp({ update }));

    const onKey = (e: KeyboardEvent) => {
      const s = useApp.getState();
      if (e.key === 'Escape') {
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

  return (
    <>
      {phase === 'welcome' ? <Welcome /> : <Shell />}
      <Toasts />
    </>
  );
}
