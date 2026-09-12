#!/usr/bin/env bash
# Run on the LAPTOP. Starts K2 + the game server locally and pins the Vultr box's
# port 8080 back to this machine over an SSH reverse tunnel. Caddy on Vultr then
# serves https://<hostname> -> this laptop. Ctrl-C stops everything.
#   ./scripts/vultr-tunnel.sh root@<vultr-ip> <hostname>
set -uo pipefail
cd "$(dirname "$0")/.."
TARGET="${1:?usage: vultr-tunnel.sh root@<ip> <hostname>}"
HOST="${2:?usage: vultr-tunnel.sh root@<ip> <hostname>}"
PORT="${PORT:-8080}"

# The tunnel lives on this laptop. If the laptop sleeps, the public URL goes dark.
pgrep -x caffeinate >/dev/null || { nohup caffeinate -dims >/dev/null 2>&1 & echo "== caffeinate started: laptop will not sleep =="; }
echo "== K2 =="
pgrep -f llama-server >/dev/null || ./scripts/start-ifm.sh
echo "== game server (K2 routing, chain on if funded) =="
export PUBLIC_URL="https://$HOST/play"
export LLM_PROVIDER="${LLM_PROVIDER:-ifm}"
export CHAIN="${CHAIN:-memo}"
node server/index.js > /tmp/me-server.log 2>&1 &
SRV=$!; sleep 2
kill -0 $SRV 2>/dev/null || { echo "server died:"; tail -20 /tmp/me-server.log; exit 1; }

echo "== reverse tunnel: $TARGET:$PORT -> localhost:$PORT (auto-reconnects) =="
trap 'kill $SRV 2>/dev/null; kill $TUN 2>/dev/null' EXIT INT TERM
( while true; do
    ssh -o ServerAliveInterval=20 -o ServerAliveCountMax=3 -o ExitOnForwardFailure=yes \
        -N -R "127.0.0.1:$PORT:localhost:$PORT" "$TARGET"
    echo "  tunnel dropped, reconnecting in 3s"; sleep 3
  done ) &
TUN=$!
sleep 4

echo
echo "========================================================"
echo "  BOARD   (this laptop)   http://localhost:$PORT/"
echo "  PHONE   (anywhere)      https://$HOST/play"
echo "========================================================"
echo "== G1 via the front door =="
code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "https://$HOST/health")
echo "  https://$HOST/health -> HTTP $code   $([ "$code" = 200 ] && echo PASS || echo FAIL)"
echo
echo "  >> Test from a phone ON CMU WIFI this time -- that is the block we are routing around."
echo "  Ctrl-C when done."
wait $SRV
