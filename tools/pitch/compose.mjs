// Turn the recorded run into the pitch video: side-by-side board + phone, narration
// placed at the real event times, Explorer close-up at the end, title + end cards.
import fs from "node:fs"; import { execSync } from "node:child_process"; import path from "node:path";
const SCR = process.argv[2]; const FINAL = process.argv[3];
const T = JSON.parse(fs.readFileSync(path.join(SCR, "timeline.json"), "utf8"));
const at = (k) => T.timeline.find(e => e.k === k)?.t;
const tStart = at("run_started") ?? 10, tAuc = at("first_auction") ?? tStart + 12, tEnd = at("run_end") ?? tStart + 70;
const tRecap = at("recap") ?? tEnd + 6, tExp = at("explorer_opened"), tStop = at("stop");
const ratio = T.timeline.find(e => e.k === "run_end")?.ratio;
const ratioWords = ratio ? `${ratio.toFixed(1).replace(".0","")} times` : "two to three times";
const sh = (c) => execSync(c, { stdio: ["ignore", "pipe", "pipe"] }).toString();
const dur = (f) => +sh(`ffprobe -v error -show_entries format=duration -of csv=p=0 "${f}"`).trim();

// ---- narration: what, and WHEN (seconds into the board video) ----
const lines = [
  [0.8,        "This is Midnight Express. Every phone in the room becomes a train, and there is not enough track for all of them."],
  [tStart-4,   "One link. No app, no wallet, no sign-up. Five seconds later you are driving."],
  [tStart+2.5, "Everyone is routing themselves home. The purple train is a rival, routed by IFM's K2 Horizon, a small model running on this laptop. No API key. No network."],
  [tAuc+0.5,   "Two trains want the same track. Eight seconds to bid. The highest bid goes first, but pays the second price, so bidding your true value is always the best move. The loser is paid for waiting."],
  [tAuc+16,    "The dispatcher on the P.A. is Gemini. It phrases every call from live game state. Every auction is being settled on Solana as it happens."],
  [tEnd+1.5,   `Same trains, same track. On the left, the room. On the right, one dispatcher with full information. The room did ${ratioWords} worse. That gap is the price of everyone acting in their own interest.`],
  [tRecap+1,   "That report was written by Grok, from the real scoreboard."],
  ...(tExp ? [[tExp+1.5, "And the part I care about most. My train co-signed its own auctions. This is the transaction. It is real, it is on devnet, and it is thirty seconds old."]] : []),
  [(tExp ? tExp+9 : tRecap+6), "Three models, each doing one job it is good at. A chain doing the one thing chains are for. And a room full of strangers, playing in five seconds. Thank you."],
].filter(([t]) => Number.isFinite(t) && t >= 0 && t < Math.min(120, dur(T.files.board)) - 4);

const clips = lines.map(([t, text], i) => { const f = path.join(SCR, `n${i}.aiff`); sh(`say -v Daniel -r 178 -o "${f}" ${JSON.stringify(text)}`); return { t, f, d: dur(f) }; });
const LEAD = 0;    // no title card on this ffmpeg build
const total = Math.min(120, dur(T.files.board));
console.log(`  narration: ${clips.length} lines, last ends ${(clips.at(-1).t + clips.at(-1).d).toFixed(1)}s; footage ${dur(T.files.board).toFixed(1)}s; program ${total.toFixed(1)}s`);

// ---- video: board 1440x900 | phone pane 416x900 (explorer overlaid there at the end) ----
const W = 1440 + 416;
const inputs = [`-i "${T.files.board}"`, `-i "${T.files.phone}"`]; let expIdx = null;
if (T.files.explorer && fs.existsSync(T.files.explorer) && tExp) { expIdx = inputs.length; inputs.push(`-i "${T.files.explorer}"`); }
clips.forEach(c => inputs.push(`-i "${c.f}"`));
const aStart = 2 + (expIdx !== null ? 1 : 0);
let fc = `[0:v]scale=1440:900,setsar=1,fps=30[b];` +
         `[1:v]scale=-2:900,setsar=1,fps=30,pad=416:900:(ow-iw)/2:0:color=0x08070C[p];` +
         `[b][p]hstack=inputs=2[main];`;
let vout = "[main]";
if (expIdx !== null) {
  fc += `[${expIdx}:v]scale=-2:900,setsar=1,fps=30,pad=416:900:(ow-iw)/2:0:color=0x08070C,setpts=PTS+${tExp}/TB[e];` +
        `[main][e]overlay=x=1440:y=0:enable='gte(t,${tExp})'[v];`;
  vout = "[v]";
}
// this ffmpeg has no drawtext (no freetype): no cards, body only, capped at 120s
fc += `${vout}trim=0:${total.toFixed(2)},setpts=PTS-STARTPTS[vfinal];`;
// audio: each clip delayed by (LEAD + t)
const aParts = clips.map((c, i) => `[${aStart + i}:a]adelay=${Math.round((LEAD + c.t) * 1000)}|${Math.round((LEAD + c.t) * 1000)}[a${i}]`).join(";");
fc += aParts + ";" + clips.map((_, i) => `[a${i}]`).join("") + `amix=inputs=${clips.length}:normalize=0,apad[afinal]`;
const outLen = total;
const cmd = `ffmpeg -y ${inputs.join(" ")} -filter_complex "${fc}" -map "[vfinal]" -map "[afinal]" -t ${outLen.toFixed(2)} -c:v libx264 -preset veryfast -crf 20 -pix_fmt yuv420p -c:a aac -b:a 160k -movflags +faststart "${FINAL}"`;
fs.writeFileSync(path.join(SCR, "ffmpeg.cmd"), cmd);
try { execSync(cmd, { stdio: ["ignore", "pipe", "pipe"] }); }
catch (e) { console.log("FFMPEG FAILED:", e.stderr.toString().split("\n").filter(l => /error|invalid|no such|failed/i.test(l)).slice(-6).join("\n")); process.exit(1); }
console.log(`  VIDEO: ${FINAL}  ${dur(FINAL).toFixed(1)}s  ${(fs.statSync(FINAL).size/1048576).toFixed(1)} MB`);
