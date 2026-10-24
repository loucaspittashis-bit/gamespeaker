import { useEffect, useRef, useState } from 'react';
import type { LocalVideoTrack, RemoteVideoTrack } from 'livekit-client';

type VideoTrack = RemoteVideoTrack | LocalVideoTrack;

export function TrackVideo({ track }: { track: VideoTrack | null }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || !track) return;
    track.attach(el);
    return () => {
      track.detach(el);
    };
  }, [track]);
  return <video ref={ref} autoPlay playsInline muted />;
}

/** Live resolution / fps / codec / bitrate of a stream, read from WebRTC stats once a second. */
export function useStreamStats(track: VideoTrack | null, enabled: boolean): string | null {
  const [text, setText] = useState<string | null>(null);
  useEffect(() => {
    if (!track || !enabled) {
      setText(null);
      return;
    }
    let prev: { bytes: number; at: number } | null = null;
    let stop = false;
    const poll = async () => {
      const report = await track.getRTCStatsReport?.();
      if (!report || stop) return;
      let width = 0;
      let height = 0;
      let fps = 0;
      let bytes = 0;
      let codecId = '';
      report.forEach((s: any) => {
        if ((s.type === 'inbound-rtp' || s.type === 'outbound-rtp') && s.kind === 'video') {
          bytes += s.bytesReceived ?? s.bytesSent ?? 0;
          if ((s.frameWidth ?? 0) >= width) {
            width = s.frameWidth ?? 0;
            height = s.frameHeight ?? 0;
            fps = s.framesPerSecond ?? fps;
            codecId = s.codecId ?? codecId;
          }
        }
      });
      const codec = (report.get(codecId) as { mimeType?: string } | undefined)?.mimeType?.split('/')[1]?.toUpperCase() ?? '';
      const now = performance.now();
      const mbps = prev ? ((bytes - prev.bytes) * 8) / ((now - prev.at) / 1000) / 1e6 : 0;
      prev = { bytes, at: now };
      if (width) setText(`${width}×${height} · ${Math.round(fps)} fps${codec ? ` · ${codec}` : ''}${mbps > 0 ? ` · ${mbps.toFixed(1)} Mbps` : ''}`);
    };
    void poll();
    const timer = window.setInterval(() => void poll(), 1000);
    return () => {
      stop = true;
      window.clearInterval(timer);
    };
  }, [track, enabled]);
  return text;
}

/** Opens the stream in its own window (drag it to another monitor). */
export function popOut(track: VideoTrack, title: string): void {
  const win = window.open('', `gs-popout-${track.sid ?? Date.now()}`, 'width=1280,height=760');
  if (!win) return;
  win.document.title = `${title} · Gamecoms`;
  win.document.body.style.cssText = 'margin:0;background:#000;height:100vh;display:flex;';
  const video = win.document.createElement('video');
  video.autoplay = true;
  video.playsInline = true;
  video.muted = true;
  video.style.cssText = 'width:100%;height:100%;object-fit:contain;background:#000;';
  video.srcObject = new MediaStream([track.mediaStreamTrack]);
  win.document.body.appendChild(video);
  void video.play().catch(() => {});
}
