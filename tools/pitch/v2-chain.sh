#!/usr/bin/env bash
# v2 pitch video: waits for the judging slot to pass, then bounce (scoreboard CSS fix) ->
# pre-flight -> record a live run -> HyperFrames build (Charon narration) -> render -> frames.
set -uo pipefail
cd "/Users/sragh/Desktop/CMU/Sem 3/HackCMU/midnight-express"
SCR="/private/tmp/claude-501/-Users-sragh-Desktop-CMU-Sem-3-HackCMU/614ed03d-2ad0-4e91-a8eb-a0173b22e09c/scratchpad/video"
HF="/private/tmp/claude-501/-Users-sragh-Desktop-CMU-Sem-3-HackCMU/614ed03d-2ad0-4e91-a8eb-a0173b22e09c/scratchpad/hf/pitch"
OUT="/Users/sragh/Desktop/CMU/Sem 3/HackCMU/midnight-express-pitch-v2.mp4"
GO="${GO_AT:-17:11}"
echo "== waiting until $GO (slot must finish first) =="; until [ "$(date '+%H:%M')" \> "$GO" ] || [ "$(date '+%H:%M')" = "$GO" ]; do sleep 15; done; date '+  go %H:%M:%S'

echo "== 1/6 bounce (loads the scoreboard fix) =="
pkill -f "server/index.js" 2>/dev/null; pkill -f "ssh .*-R 127.0.0.1:8080" 2>/dev/null; pkill -f "vultr-tunnel.sh|vultr-go.sh" 2>/dev/null; sleep 2
( ./scripts/vultr-go.sh 155.138.204.133 > /tmp/vultr-go.log 2>&1 & )
for i in $(seq 1 30); do [ "$(curl -s -o /dev/null -w '%{http_code}' --max-time 6 https://155-138-204-133.sslip.io/health 2>/dev/null)" = "200" ] && break; sleep 3; done; sleep 6
echo "== 2/6 pre-flight =="; ./scripts/preflight.sh 2>&1 | grep -E "FAIL|ALL CLEAR" | head -5
echo "== 3/6 record (real run) =="; date '+  %H:%M:%S'
rm -rf "$SCR/board" "$SCR/phone" "$SCR/timeline.json"
node scripts/pitch/record.mjs 2>&1 | grep -E "run_started|first_auction|run_end|recap|receipt|explorer_|stop|DONE|Error" | grep -v phone_bid | tail -10
[ -f "$SCR/timeline.json" ] || { echo "RECORD FAILED"; exit 1; }
echo "== 4/6 build (Charon) =="; node scripts/pitch/hf-build.mjs "$SCR" "$HF" 2>&1 | tail -4
( cd "$HF" && HYPERFRAMES_SKIP_SKILLS=1 npx --prefix "/Users/sragh/Desktop/CMU/Sem 3/HackCMU/midnight-express" --no-install hyperframes lint . 2>&1 | sed 's/\x1b\[[0-9;?]*[a-zA-Z]//g' | grep -E "✗|error\(s\)" | head -5 )
echo "== 5/6 render =="; date '+  %H:%M:%S'
( cd "$HF" && HYPERFRAMES_SKIP_SKILLS=1 npx --prefix "/Users/sragh/Desktop/CMU/Sem 3/HackCMU/midnight-express" --no-install hyperframes render . -o "$OUT" -f 30 -q high --video-frame-format png 2>&1 | sed 's/\x1b\[[0-9;?]*[a-zA-Z]//g' | grep -E "Render complete|MB ·|rendered in|Error|error" | head -4 )
echo "== 6/6 frames =="; date '+  %H:%M:%S'
[ -f "$OUT" ] && { for t in 2 30 96 108 117; do ffmpeg -y -v error -ss $t -i "$OUT" -frames:v 1 -vf scale=928:-1 "$SCR/v2_$t.jpg"; done
  printf "  READY %s  %ss  %s MB  audio mean %s\n" "$(basename "$OUT")" "$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$OUT" | cut -c1-5)" "$(du -m "$OUT" | cut -f1)" "$(ffmpeg -v info -i "$OUT" -map 0:a -af volumedetect -f null - 2>&1 | grep -oE 'mean_volume: [-0-9.]+ dB')"; } || echo "  NO OUTPUT"
