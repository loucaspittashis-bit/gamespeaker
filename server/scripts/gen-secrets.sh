#!/bin/sh
# Fills LIVEKIT_API_KEY, LIVEKIT_API_SECRET and SESSION_SECRET in .env
# (creating .env from .env.example if needed). Existing values are kept.
set -eu
cd "$(dirname "$0")/.."

[ -f .env ] || cp .env.example .env

rand() { openssl rand -base64 64 | tr -dc 'A-Za-z0-9' | head -c "$1"; }

set_if_empty() {
  key="$1"; value="$2"
  if grep -q "^$key=$" .env; then
    sed -i.bak "s|^$key=$|$key=$value|" .env && rm -f .env.bak
    echo "set $key"
  else
    echo "kept $key"
  fi
}

set_if_empty LIVEKIT_API_KEY "API$(rand 12)"
set_if_empty LIVEKIT_API_SECRET "$(rand 48)"
set_if_empty SESSION_SECRET "$(rand 48)"
chmod 600 .env
