# Gamespeaker

Our own private voice, chat and streaming server. Voice that feels like the same room,
streams up to 4K60, chat history that stays, and nobody else on it.

## Join (for friends)

### Windows

1. Download **Gamespeaker-Setup.exe** from the latest release: [Releases](../../releases/latest).
2. Run it. Windows will warn you, because the app isn't signed (signing costs money every year):
   click **More info**, then **Run anyway**. You only see this once; updates install themselves.
3. Pick a nickname, type the server password you were sent, choose your mic and speakers, and
   pick a neon color.
4. Click **Join server**. Click a voice channel to hop in.

### Mac, Linux, phone, or a computer you can't install on

Open the server address in **Chrome** (or Edge) and sign in the same way. Voice, chat, watching
streams and going live all work in the browser. The desktop app adds push-to-talk while you're
in a game and per-app stream sound.

## Using it

| You want to | Do this |
|---|---|
| Talk | Click a voice channel. A neon ring shows who's speaking. |
| Mute / deafen | The mic and headphone buttons bottom-left, or Ctrl+Shift+M / Ctrl+Shift+D |
| Push to talk | Settings → Voice & audio → Push to talk. The default key is Mouse 4. It works in-game. |
| Turn someone up or down | Right-click them → Volume (0–200%), or Mute for me |
| Go live | **Go Live**, pick a game or screen, then pick the quality |
| Watch a stream | Click their tile. Hover for stats, pop it out, or go fullscreen. |
| Mute someone's game sound but keep their voice | Right-click them → Mute stream sound |
| Change your neon color | The palette icon at the top of a voice channel, or Settings → Appearance |
| Clean up a noisy mic | Settings → Voice & audio → Noise suppression: Standard or High |

**Stream quality and your upload speed:** 1080p60 needs about 10 Mbps of upload, 1440p60 about
19 Mbps, and 4K60 about 40 Mbps. Run a speed test before going 4K.

---

## For the server owner

```
server/   LiveKit + gateway + Caddy (Docker Compose), deploy guide, tests
app/      Desktop app (Electron + React) and the web version
```

- **Deploy the server:** [server/DEPLOY.md](server/DEPLOY.md)
- **Run everything locally without Docker** (needs `brew install livekit caddy node`):

  ```bash
  server/scripts/local-stack.sh start
  ```

  Then open <http://localhost:8088> after building the web client (`cd app && npm ci && npm run build:web`),
  or run the desktop app with `cd app && npm run dev`.
- **Test the server end to end:** `cd server/e2e && npm install && E2E_PASSWORD=... npm run e2e`
- **Release a new desktop version:** set the repository variable `GAMESPEAKER_SERVER_URL` once
  (see [.github/workflows/release.yml](.github/workflows/release.yml)). Then bump `version` in
  `app/package.json`, commit, and push a tag such as `v0.2.0`. GitHub Actions builds the Windows
  installer and publishes it, and everyone's app updates itself.
