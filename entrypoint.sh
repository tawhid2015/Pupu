#!/bin/bash
set -e

export PORT="${PORT:-8001}"
export LAVALINK_PORT="${LAVALINK_PORT:-2333}"

echo "========================================================"
echo "  Starting Pupu All-in-One Stack on Railway"
echo "  - Web Dashboard & API on port: $PORT"
echo "  - Lavalink audio engine on internal port: $LAVALINK_PORT"
echo "  - yt-cipher on internal port: 8002"
echo "========================================================"

mkdir -p /var/log/supervisor

exec /usr/bin/supervisord -c /app/supervisord.conf
