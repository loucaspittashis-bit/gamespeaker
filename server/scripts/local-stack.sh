#!/bin/sh
# Runs the whole server stack on this machine without Docker, for testing:
#   LiveKit (127.0.0.1:7880, media on 7881/tcp + 7882/udp)
#   gateway (127.0.0.1:3000)
#   Caddy   (http://localhost:8088, the address clients use)
#
# Usage: scripts/local-stack.sh start | stop | status
# Needs: livekit-server, caddy, node 24 (brew install livekit caddy node)
set -eu
cd "$(dirname "$0")/.."
SERVER_DIR=$(pwd)
LOCAL=.local
CADDY_PORT=8088

stop() {
  for svc in caddy gateway livekit; do
    if [ -f "$LOCAL/$svc.pid" ]; then
      pid=$(cat "$LOCAL/$svc.pid")
      kill "$pid" 2>/dev/null || true
      # LiveKit drains rooms on SIGTERM; don't wait for that in a test stack.
      i=0
      while kill -0 "$pid" 2>/dev/null && [ "$i" -lt 15 ]; do sleep 0.2; i=$((i + 1)); done
      kill -9 "$pid" 2>/dev/null || true
      rm -f "$LOCAL/$svc.pid"
    fi
  done
}

wait_for() {
  url=$1; name=$2
  i=0
  until curl -sf "$url" >/dev/null 2>&1; do
    i=$((i + 1))
    if [ "$i" -gt 50 ]; then echo "$name did not come up; see $LOCAL/$name.log"; stop; exit 1; fi
    sleep 0.2
  done
}

start() {
  stop
  mkdir -p "$LOCAL/data"

  if [ ! -f "$LOCAL/env" ]; then
    rand() { openssl rand -base64 64 | tr -dc 'A-Za-z0-9' | head -c "$1"; }
    cat > "$LOCAL/env" <<EOF
SERVER_NAME="Gamespeaker (local)"
SERVER_PASSWORD=local-test-password
LIVEKIT_API_KEY=APIlocal$(rand 8)
LIVEKIT_API_SECRET=$(rand 48)
SESSION_SECRET=$(rand 48)
EOF
  fi
  set -a; . "$LOCAL/env"; set +a

  # Same config as production, but advertise localhost instead of the public IP.
  sed 's/use_external_ip: true/use_external_ip: false/' livekit.yaml > "$LOCAL/livekit.yaml"

  # Browsers that hide local addresses (privacy mode) can't reach 127.0.0.1;
  # LAN=1 advertises this machine's network address instead.
  NODE_IP=127.0.0.1
  if [ "${LAN:-}" = "1" ]; then
    NODE_IP=$(ipconfig getifaddr en0 2>/dev/null || hostname -I 2>/dev/null | awk '{print $1}')
  fi
  LIVEKIT_KEYS="$LIVEKIT_API_KEY: $LIVEKIT_API_SECRET" \
    livekit-server --config "$LOCAL/livekit.yaml" --bind 127.0.0.1 --node-ip "$NODE_IP" \
    > "$LOCAL/livekit.log" 2>&1 &
  echo $! > "$LOCAL/livekit.pid"

  (cd gateway && HOST=127.0.0.1 PORT=3000 DATA_DIR="$SERVER_DIR/$LOCAL/data" \
    LIVEKIT_URL="ws://localhost:$CADDY_PORT" \
    exec node --disable-warning=ExperimentalWarning src/index.ts) > "$LOCAL/gateway.log" 2>&1 &
  echo $! > "$LOCAL/gateway.pid"

  mkdir -p "$LOCAL/caddy"
  XDG_DATA_HOME="$SERVER_DIR/$LOCAL/caddy" XDG_CONFIG_HOME="$SERVER_DIR/$LOCAL/caddy" \
    DOMAIN="http://localhost:$CADDY_PORT" WEB_ROOT="$SERVER_DIR/web" \
    caddy run --config Caddyfile --adapter caddyfile > "$LOCAL/caddy.log" 2>&1 &
  echo $! > "$LOCAL/caddy.pid"

  wait_for "http://127.0.0.1:7880" livekit
  wait_for "http://localhost:$CADDY_PORT/api/health" caddy
  echo "Local stack is up at http://localhost:$CADDY_PORT (password: $SERVER_PASSWORD)"
}

case "${1:-}" in
  start) start ;;
  stop) stop; echo "stopped" ;;
  status)
    for svc in livekit gateway caddy; do
      if [ -f "$LOCAL/$svc.pid" ] && kill -0 "$(cat "$LOCAL/$svc.pid")" 2>/dev/null; then echo "$svc: running"; else echo "$svc: stopped"; fi
    done ;;
  *) echo "usage: $0 start|stop|status"; exit 1 ;;
esac
