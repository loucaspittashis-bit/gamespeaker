# Deploying the Gamespeaker server

This puts the server on a VPS so it runs 24/7: voice and video (LiveKit), login, presence and
chat (gateway), and HTTPS (Caddy). Setup takes about 20 minutes.

We use **OVHcloud VPS-2 in London**: about 62 ms from Cyprus, unlimited traffic, 1 Gbps, about
€10/month with VAT and no commitment. Any Ubuntu 24.04 VPS works; Hetzner steps are included as
an alternative.

## What you need

- An OVHcloud account, registered as an **individual**: <https://www.ovhcloud.com/en-ie/vps/>
- An SSH key on your computer. Check with `ls ~/.ssh/id_ed25519.pub`, or make one with
  `ssh-keygen -t ed25519`.
- A free DuckDNS account: <https://www.duckdns.org>

In the commands below, replace `YOUR_SERVER_IP` with the server's IPv4 address.

## 1. Create the server

### OVHcloud (what we use)

On the VPS page, click **Configure** on **VPS-2** and choose:

| Setting | Choose |
|---|---|
| Commitment | **No commitment** |
| Location | **Europe → United Kingdom (Erith)**. France (Gravelines/Strasbourg) is about 5 ms faster when in stock. |
| Image | **Distribution only → Ubuntu → Version 24.04** |
| Options | None. Daily backup is already included. |

After paying, OVH emails the server's **IPv4 address** and the login for user `ubuntu`. Put your
SSH key on it once (it asks for the password from OVH's email):

```bash
ssh-copy-id ubuntu@YOUR_SERVER_IP
```

Then run the setup script. It installs Docker, turns on automatic security updates (with a
05:00 reboot window), allows SSH keys only, and opens just the ports listed below:

```bash
scp server/scripts/setup-server.sh ubuntu@YOUR_SERVER_IP:
ssh ubuntu@YOUR_SERVER_IP 'sudo sh setup-server.sh'
```

### Hetzner (alternative)

In the Hetzner Console click **Add server**: Nuremberg, Ubuntu 24.04, Shared vCPU → x86 → CX23,
your SSH key, a firewall with the ports below, and paste [`cloud-init.yaml`](cloud-init.yaml)
into **Cloud config** (it does the same as the setup script). Log in as `root` instead of
`ubuntu` in the steps below.

### Ports the server opens

| Protocol | Port | What it's for |
|---|---|---|
| TCP | 22 | SSH |
| TCP | 80 | Let's Encrypt certificate checks, redirect to HTTPS |
| TCP | 443 | The app: website, login, chat, voice signalling |
| UDP | 443 | HTTP/3 (faster page loads, optional) |
| TCP | 7881 | Voice/video fallback for networks that block UDP |
| UDP | 7882 | Voice and video |

## 2. Point your domain at it

On duckdns.org, add a subdomain (for example `ourcrew`) and set its IP to the server's IPv4
address. The server's IP never changes, so you don't need an updater.

Your address is now `ourcrew.duckdns.org`.

## 3. Build the web client and copy the server files

The server also hosts the web version of the app (for Mac, Linux and phones). Build it into
`server/web` first. From the project folder on your computer:

```bash
cd app && npm ci && npm run build:web && cd ..
```

Then copy everything up:

```bash
rsync -av --exclude node_modules --exclude .local --exclude e2e server/ ubuntu@YOUR_SERVER_IP:/opt/gamespeaker/
```

## 4. Configure and start

```bash
ssh ubuntu@YOUR_SERVER_IP
cd /opt/gamespeaker
cp .env.example .env
nano .env
```

In `.env`, set:

- `DOMAIN` to your DuckDNS address, for example `ourcrew.duckdns.org` (no `https://`)
- `SERVER_PASSWORD` to the password you'll give your friends

Save the file (Ctrl+O, Enter, Ctrl+X), then generate the secrets and start everything:

```bash
sh scripts/gen-secrets.sh
docker compose up -d --build
docker compose ps
```

The last line printed is your **admin password**. Keep it to yourself: in the app, open
Settings > Server admin and type it to manage channels, the server name, the friends' password,
and to kick or ban people.

All three services should show `running` (the gateway shows `healthy` after about 30 seconds).
Watch Caddy get the HTTPS certificate:

```bash
docker compose logs -f caddy
```

Look for `certificate obtained successfully`, then press Ctrl+C. Open
`https://ourcrew.duckdns.org` in Chrome and you should see the Gamespeaker welcome screen.

Then set the repository variable `GAMESPEAKER_SERVER_URL` to `https://ourcrew.duckdns.org` on
GitHub and push a version tag, so the desktop installer is built pointing at your server (see
the main README).

## 5. Check it end to end

From your computer, run the same bot test used during development. Two bots log in, join a
voice channel, and stream audio and 1080p video to each other through the real server:

```bash
cd server/e2e
npm install
E2E_BASE=https://ourcrew.duckdns.org E2E_PASSWORD='your server password' npm run e2e
```

You should see `E2E PASSED`. If login works but the video check fails, UDP 7882 is blocked;
see Troubleshooting.

## Keeping it running 24/7

These happen automatically:

- **Crashes and reboots:** every container has `restart: unless-stopped`, and Docker starts on boot.
- **Security updates:** Ubuntu installs them nightly and reboots at 05:00 server time when a
  kernel update needs it. The app is back within a minute.
- **HTTPS certificates:** Caddy renews them before they expire.
- **Backups:** OVH takes a daily backup of the whole server.

Set up the one thing that isn't automatic: a free uptime monitor that alerts your phone if the
server goes down. On <https://uptimerobot.com>, add an **HTTP(s)** monitor for
`https://ourcrew.duckdns.org/api/health` every 5 minutes.

## Everyday tasks

**Update the server** (after pulling or copying new files):

```bash
cd /opt/gamespeaker
docker compose pull
docker compose up -d --build
```

**Change channels, the server name or the friends' password:** use Settings > Server admin in
the app. Changes apply to everyone straight away. Changing the password signs everyone out.

These changes are saved on the server in `settings.json` (in the `gateway-data` volume) and take
priority over `SERVER_NAME`, `SERVER_PASSWORD` and `CHANNELS` in `.env`. To go back to the `.env`
values, delete that file and restart:

```bash
docker compose exec gateway rm /data/settings.json
docker compose restart gateway
```

**Forgot the admin password:** `grep ADMIN_PASSWORD .env`. To change it, edit that line and run
`docker compose up -d`; anyone unlocked with the old one is locked again.

**See logs:** `docker compose logs -f gateway` (or `livekit`, `caddy`).

**Back up just the chat history:** it lives in the `gateway-data` volume.

```bash
docker run --rm -v gamespeaker_gateway-data:/data -v "$PWD":/backup alpine tar czf /backup/chat-backup.tgz -C /data .
```

## Bandwidth

OVH's VPS-2 has unlimited traffic on a 1 Gbps port. A 1440p60 stream uses about 7 GB per viewer
per hour (1080p60 about 3.5 GB), and 6 people all watching 1440p60 need about 110 Mbps. Friends
watching a small tile only download a small preview.

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| The site doesn't load, or there's a certificate error | DuckDNS isn't pointing at the server yet, or TCP 80/443 is closed. Check `docker compose logs caddy`. |
| Login and chat work, but voice never connects | UDP 7882 and TCP 7881 are blocked. Check `sudo ufw status` on the server (and the Hetzner firewall, if you use Hetzner). |
| Voice works on most networks but not one | That network blocks UDP. LiveKit falls back to TCP 7881 automatically, at slightly higher latency. |
| "Too many attempts" when logging in | 10 wrong passwords from one address in 10 minutes. Wait 10 minutes. |
| The gateway keeps restarting | A required `.env` value is missing. `docker compose logs gateway` says which one. |
| `permission denied` running `docker` | Log out and back in once after the setup script, so your user joins the `docker` group. |
