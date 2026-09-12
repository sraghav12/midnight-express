#!/usr/bin/env bash
# ONE COMMAND to put Midnight Express on a public HTTPS URL and run the G1 gate.
#   ./scripts/go-public.sh
# Ctrl-C stops everything.
set -uo pipefail
cd "$(dirname "$0")/.."
PORT="${PORT:-8080}"
rm -f .public-url

command -v cloudflared >/dev/null || { echo "cloudflared missing -- run: brew install cloudflared"; exit 1; }

echo "== starting the game server on :$PORT =="
node server/index.js > /tmp/me-server.log 2>&1 &
SRV=$!
sleep 2
kill -0 $SRV 2>/dev/null || { echo "server died:"; tail -20 /tmp/me-server.log; exit 1; }

echo "== opening a public tunnel (no signup, free) =="
cloudflared tunnel --url "http://localhost:$PORT" > /tmp/me-tunnel.log 2>&1 &
TUN=$!
trap 'kill $SRV $TUN 2>/dev/null; rm -f .public-url' EXIT INT TERM

URL=""
for i in $(seq 1 40); do
  URL=$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' /tmp/me-tunnel.log 2>/dev/null | head -1)
  [ -n "$URL" ] && break
  sleep 1
done
[ -z "$URL" ] && { echo "tunnel never came up:"; tail -20 /tmp/me-tunnel.log; exit 1; }

echo "$URL" > .public-url
echo
echo "========================================================"
echo "  BOARD   (this laptop)   http://localhost:$PORT/"
echo "  PHONE   (anywhere)      $URL/play"
echo "  The QR on the board now points at the public URL."
echo "========================================================"
echo
echo "== G1 GATE =="
HOST=$(echo "$URL" | sed 's|https://||')

# This laptop's resolver may refuse the hostname even when the tunnel is fine:
# many networks (CMU's included) wildcard-block *.trycloudflare.com because
# throwaway tunnels get abused for phishing. So ask a PUBLIC resolver, and if
# the local one disagrees, say so rather than reporting a false failure.
IP=$(dig +short @1.1.1.1 "$HOST" 2>/dev/null | head -1)
LOCAL_IP=$(dig +short "$HOST" 2>/dev/null | head -1)

if [ -z "$IP" ]; then
  echo "  public DNS cannot resolve the tunnel yet -- give it a few seconds and retry"
else
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 --resolve "$HOST:443:$IP" "$URL/health")
  echo "  tunnel health (via public DNS): HTTP $code"
  if [ "$code" = "200" ]; then
    echo "  tunnel: UP and publicly reachable"
  else
    echo "  tunnel: FAIL -- the tunnel itself is not serving"
  fi
  if [ -z "$LOCAL_IP" ]; then
    echo
    echo "  !! THIS NETWORK BLOCKS THE TUNNEL HOSTNAME (local DNS says NXDOMAIN)."
    echo "     Your laptop cannot open the URL, but phones on CELLULAR can."
    echo "     IMPORTANT: judges on this wifi will hit the same block at the expo."
    echo "     For the real demo use a proper host + domain (Vultr), not a tunnel."
  fi
fi
echo
echo "  >> NOW THE PART THAT ACTUALLY MATTERS <<"
echo "  Take a phone. TURN WIFI OFF (cellular only)."
echo "  Open:  $URL/play"
echo "  If a train appears and moves, G1 PASSES."
echo
echo "  Ctrl-C here when you're done."
wait $SRV
