#!/usr/bin/env bash
# G1 GATE: can a phone on CELLULAR hold a WSS connection to the public host?
# Usage: ./scripts/g1-check.sh wss://your-host
# Run this from a laptop, then repeat the URL on a phone with WIFI OFF.
set -euo pipefail
URL="${1:?usage: g1-check.sh wss://host}"
HTTP="${URL/wss:/https:}"; HTTP="${HTTP/ws:/http:}"

echo "== 1. health =="
curl -sS --max-time 8 "$HTTP/health" && echo
echo "== 2. TLS =="
curl -sS -o /dev/null -w "  http %{http_code}  tls %{ssl_verify_result}  total %{time_total}s\n" --max-time 8 "$HTTP/"
echo "== 3. websocket 60s hold =="
node scripts/ws-hold.js "$URL"
echo
echo "NOW DO THE PART THAT ACTUALLY MATTERS:"
echo "  open $HTTP/play on a phone with WIFI OFF (cellular only)."
echo "  If it does not connect, switch hosts immediately. Do not debug past midnight."
