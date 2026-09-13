#!/usr/bin/env bash
# footage -> ffmpeg cut (fast, safe) -> HyperFrames build -> lint -> render
set -uo pipefail
cd "/Users/sragh/Desktop/CMU/Sem 3/HackCMU/midnight-express"
SCR="/private/tmp/claude-501/-Users-sragh-Desktop-CMU-Sem-3-HackCMU/614ed03d-2ad0-4e91-a8eb-a0173b22e09c/scratchpad/video"
HF="/private/tmp/claude-501/-Users-sragh-Desktop-CMU-Sem-3-HackCMU/614ed03d-2ad0-4e91-a8eb-a0173b22e09c/scratchpad/hf/pitch"
DESK="/Users/sragh/Desktop/CMU/Sem 3/HackCMU"
echo "== waiting for footage =="; for i in $(seq 1 100); do [ -f "$SCR/timeline.json" ] && break; sleep 3; done
[ -f "$SCR/timeline.json" ] || { echo "NO FOOTAGE after 5 min"; exit 1; }
echo "== 1/3 ffmpeg cut (the safe deliverable) =="; date '+  %H:%M'
node scripts/pitch/compose.mjs "$SCR" "$DESK/midnight-express-pitch.mp4" 2>&1 | tail -4
echo "== 2/3 HyperFrames build =="
node scripts/pitch/hf-build.mjs "$SCR" "$HF" 2>&1 | tail -4
( cd "$HF" && HYPERFRAMES_SKIP_SKILLS=1 npx --prefix "/Users/sragh/Desktop/CMU/Sem 3/HackCMU/midnight-express" --no-install hyperframes lint . 2>&1 | sed 's/\x1b\[[0-9;?]*[a-zA-Z]//g' | grep -vE "^\s*$|telemetry|anonymous|HeyGen|Disable" | tail -12 )
echo "== 3/3 HyperFrames render (120s @30fps) =="; date '+  %H:%M'
( cd "$HF" && HYPERFRAMES_SKIP_SKILLS=1 npx --prefix "/Users/sragh/Desktop/CMU/Sem 3/HackCMU/midnight-express" --no-install hyperframes render . -o "$DESK/midnight-express-pitch-hyperframes.mp4" -f 30 -q standard --video-frame-format png --quiet 2>&1 | sed 's/\x1b\[[0-9;?]*[a-zA-Z]//g' | grep -vE "^\s*$|telemetry|anonymous|HeyGen|Disable" | tail -8 )
date '+  %H:%M'
for f in "$DESK"/midnight-express-pitch*.mp4; do [ -f "$f" ] && printf "  READY  %s  %ss  %s MB\n" "$(basename "$f")" "$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$f" | cut -c1-5)" "$(du -m "$f" | cut -f1)"; done
