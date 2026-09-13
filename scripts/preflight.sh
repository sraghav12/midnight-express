#!/usr/bin/env bash
# PRE-FLIGHT. Run at 1 PM (freeze) and again 15 minutes before judging.
#   ./scripts/preflight.sh <public-hostname>
# Every line is PASS or FAIL. Anything FAIL: fix it or run ./scripts/vultr-go.sh again.
set -uo pipefail
cd "$(dirname "$0")/.."
export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"
HOST="${1:?usage: preflight.sh <public-hostname>}"
TREASURY="48sFG5ydaaEpME7bdfyAUGw6Aj6KqVyyEf4CuGY5ngaD"
ok(){ printf "  PASS  %s\n" "$1"; } ; bad(){ printf "  FAIL  %s\n" "$1"; FAILS=$((FAILS+1)); }
FAILS=0
echo "== MIDNIGHT EXPRESS PRE-FLIGHT  $(date '+%H:%M')  https://$HOST =="

# 1. this network resolves the hostname (the trycloudflare lesson)
ip=$(dig +short "$HOST" 2>/dev/null | head -1)
[ -n "$ip" ] && ok "this wifi resolves $HOST -> $ip" || bad "this wifi does NOT resolve $HOST (judges here won't either)"

# 2. front door: https, valid cert, fast
code=$(curl -s -o /tmp/pf-health.json -w '%{http_code} %{ssl_verify_result} %{time_total}' --max-time 12 "https://$HOST/health" 2>/dev/null)
set -- $code
if [ "${1:-}" = "200" ] && [ "${2:-1}" = "0" ]; then ok "front door HTTPS 200, cert valid, ${3}s"; else bad "front door: HTTP ${1:-none} cert ${2:-?}"; fi

# 3. what the server says about itself
if [ -s /tmp/pf-health.json ]; then
  node -e '
    const j=JSON.parse(require("fs").readFileSync("/tmp/pf-health.json","utf8"));
    const ok=(m)=>console.log("  PASS  "+m), bad=(m)=>{console.log("  FAIL  "+m); process.exitCode=1};
    /K2|IFM/.test(j.llm?.label||"") ? ok(`brain: ${j.llm.label}`) : bad(`brain is "${j.llm?.label}" (expected IFM K2 -- is K2 up? ./scripts/start-ifm.sh)`);
    j.voice==="gemini" ? ok("voice: gemini") : bad(`voice is "${j.voice}" (DISPATCHER_PROVIDER=gemini in .env?)`);
    j.chain?.enabled ? ok(`chain: ${j.chain.label} enabled`) : bad(`chain disabled: ${j.chain?.reason}`);
    j.joinable ? ok("lobby joinable") : bad(`phase=${j.phase} not joinable (stuck run? it auto-resets in 20s)`);
  ' || FAILS=$((FAILS+1))
fi

# 4. /play actually serves the phone client
sz=$(curl -s --max-time 12 "https://$HOST/play" | wc -c | tr -d ' ')
[ "${sz:-0}" -gt 10000 ] && ok "/play serves the phone client ($sz bytes)" || bad "/play returned $sz bytes"

# 5. the QR points at the public URL, not localhost
q=$(curl -s --max-time 5 http://localhost:8080/join-url 2>/dev/null)
echo "$q" | grep -q "https://$HOST/play" && ok "QR encodes https://$HOST/play" || bad "QR encodes $q"

# 6. local processes
pgrep -f "ssh .*-R 127.0.0.1:8080" >/dev/null && ok "reverse tunnel process up" || bad "reverse tunnel NOT running"
pgrep -f "server/index.js" >/dev/null && ok "game server process up" || bad "game server NOT running"
curl -s --max-time 4 http://localhost:8090/health >/dev/null && ok "K2 llama-server on :8090" || bad "K2 not answering on :8090"

# 7. money
bal=$(solana balance "$TREASURY" --url devnet 2>/dev/null | awk '{print $1}')
awk "BEGIN{exit !(${bal:-0} >= 0.05)}" && ok "treasury ${bal} SOL (each auction ~0.000005)" || bad "treasury ${bal:-?} SOL -- fund at faucet.solana.com"

# 8. the laptop itself
pct=$(pmset -g batt 2>/dev/null | grep -oE '[0-9]+%' | head -1 | tr -d '%')
pmset -g batt 2>/dev/null | grep -qi "AC Power" && ok "laptop on AC power (${pct:-?}%)" || bad "laptop on BATTERY (${pct:-?}%) -- plug in before judging"
caff=$(pgrep -x caffeinate >/dev/null && echo yes || echo no)
[ "$caff" = yes ] && ok "sleep prevented (caffeinate running)" || bad "laptop may sleep -> tunnel dies. Run:  caffeinate -dims &"

echo
[ "$FAILS" -eq 0 ] && echo "  ALL CLEAR — go." || echo "  $FAILS FAIL(s) above. Fix, or re-run: ./scripts/vultr-go.sh <ip>"
exit $FAILS
