// Build a 120s HyperFrames composition from the recorded run + timeline.
//   node scripts/pitch/hf-build.mjs <scratch/video> <hf/pitch>
import "../../server/env.js";   // load .env FIRST -- without this the TTS keys are invisible and every line falls back to `say`
import fs from "node:fs"; import path from "node:path"; import { execSync } from "node:child_process";
const [SCR, PROJ] = process.argv.slice(2);
const T = JSON.parse(fs.readFileSync(path.join(SCR, "timeline.json"), "utf8"));
const at = (k) => T.timeline.find(e => e.k === k)?.t;
const sh = (c) => execSync(c, { stdio: ["ignore", "pipe", "pipe"] }).toString();
const dur = (f) => +sh(`ffprobe -v error -show_entries format=duration -of csv=p=0 "${f}"`).trim();
const A = path.join(PROJ, "assets"); fs.mkdirSync(A, { recursive: true });
for (const [k, f] of Object.entries(T.files)) if (f && fs.existsSync(f)) fs.copyFileSync(f, path.join(A, `${k}.webm`));
const boardLen = dur(path.join(A, "board.webm"));

// --- footage timeline (seconds into the board recording) ---
const tJoin = at("phone_joined") ?? 4, tStart = at("run_started") ?? tJoin + 8, tAuc = at("first_auction") ?? tStart + 12;
const tEnd = at("run_end") ?? tStart + 70, tRecap = at("recap") ?? tEnd + 6, tExp = at("explorer_opened");
const ratio = T.timeline.find(e => e.k === "run_end")?.ratio; const ratioWords = ratio ? `${ratio.toFixed(1).replace(/\.0$/,"")} times` : "two to three times";

// --- composition plan: 120s exactly ---
const TITLE = 4, EXP = tExp ? 11 : 0, END = 6, MAIN = 120 - TITLE - EXP - END;   // 99 or 110
const a0 = Math.max(0, tJoin - 1.5);
const needed = (tEnd + 13) - a0;                          // footage we want to show end-to-end
let clips;                                               // [{compStart, mediaStart, duration}]
if (needed <= MAIN) {
  clips = [{ c: TITLE, m: a0, d: needed }];
} else {                                                 // jump-cut the middle of the run
  const dB = 19, b0 = tEnd - 6;
  const dA = MAIN - dB, aEnd = a0 + dA;
  clips = [{ c: TITLE, m: a0, d: dA }, { c: TITLE + dA, m: b0, d: dB }];
}
const mainEnd = clips.at(-1).c + clips.at(-1).d;
const toComp = (t) => { for (const k of clips) if (t >= k.m && t <= k.m + k.d) return k.c + (t - k.m); return null; };

// --- narration (macOS say -> mp3), placed at real moments ---
const N = [
  [0.6,               "This is Midnight Express. Every phone in the room becomes a train, and there is not enough track for all of them.", "abs"],
  [tJoin - 1.0,       "One link. No app, no wallet, no sign-up. Five seconds later, you are driving."],
  [tStart + 2.5,      "Everyone is routing themselves home. The purple train is a rival, routed by IFM's K2 Horizon, a small model running on this laptop. No API key. No network."],
  [tAuc + 0.4,        "Two trains want the same track. Eight seconds to bid. The highest bid goes first but pays the second price, so bidding your true value is always the best move. The loser is paid for waiting."],
  [tAuc + 17,         "The dispatcher on the P.A. is Gemini, phrasing every call from live game state. And every auction is being settled on Solana as it happens."],
  [tEnd + 1.5,        `Same trains, same track. Left, the room. Right, one dispatcher with full information. The room did ${ratioWords} worse. That gap is the price of everyone acting in their own interest.`],
  [tRecap + 0.8,      "That report was written by Grok, from the real scoreboard."],
];
const lines = [];
for (const [t, text, mode] of N) { const c = mode === "abs" ? t : toComp(t); if (c !== null && c < mainEnd) lines.push({ c, text }); }
if (EXP) lines.push({ c: mainEnd + 0.8, text: "And the part I care about most. My train co-signed its own auctions. This is the transaction. It is real, it is on devnet, and it is thirty seconds old." });
lines.push({ c: 120 - END + 0.3, text: "Three models, each doing one job it is good at. A chain doing the one thing chains are for. Thank you." });
// Narration: Gemini TTS (the same sponsor model that voices the in-game dispatcher),
// falling back to macOS `say` per line if the API is unavailable. VOICE / TTS_MODEL
// are env-tunable so the team can A/B voices without touching code.
const TTS_MODEL = process.env.TTS_MODEL || "gemini-3.1-flash-tts-preview";
const VOICE = process.env.TTS_VOICE || "Charon";
const STYLE = "Read this as a calm, dry, slightly wry 1920s railway dispatcher over a station P.A. Measured pace, no theatrics: ";
async function tts(text, mp3) {
  const key = process.env.GEMINI_API_KEY; if (!key) throw new Error("no GEMINI_API_KEY");
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${TTS_MODEL}:generateContent?key=${key}`, { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ contents: [{ parts: [{ text: STYLE + text }] }], generationConfig: { responseModalities: ["AUDIO"], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: VOICE } } } } }),
    signal: AbortSignal.timeout(90000) });
  const j = await r.json(); const part = j.candidates?.[0]?.content?.parts?.find(p => p.inlineData);
  if (!part) throw new Error(j.error?.message || "no audio");
  const rate = +(/rate=(\d+)/.exec(part.inlineData.mimeType)?.[1] ?? 24000);
  const raw = mp3.replace(/\.mp3$/, ".raw"); fs.writeFileSync(raw, Buffer.from(part.inlineData.data, "base64"));
  sh(`ffmpeg -y -v error -f s16le -ar ${rate} -ac 1 -i "${raw}" -codec:a libmp3lame -q:a 2 "${mp3}"`); fs.unlinkSync(raw);
}
// ElevenLabs first (NARRATOR=elevenlabs, default when a key exists), then Gemini TTS, then say.
const NARRATOR = process.env.NARRATOR || (process.env.ELEVENLABS_API_KEY ? "elevenlabs" : "gemini");
const EL_VOICE = process.env.ELEVENLABS_VOICE_ID || "";
const EL_MODEL = process.env.ELEVENLABS_MODEL || "eleven_multilingual_v2";
async function elevenlabs(text, mp3) {
  const key = process.env.ELEVENLABS_API_KEY; if (!key || !EL_VOICE) throw new Error("no ElevenLabs key/voice");
  const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${EL_VOICE}?output_format=mp3_44100_128`, { method: "POST", headers: { "xi-api-key": key, "content-type": "application/json" },
    body: JSON.stringify({ text, model_id: EL_MODEL, voice_settings: { stability: 0.55, similarity_boost: 0.8, style: 0.2 } }), signal: AbortSignal.timeout(90000) });
  if (!r.ok) throw new Error(`elevenlabs ${r.status}`);
  fs.writeFileSync(mp3, Buffer.from(await r.arrayBuffer()));
}
const used = { elevenlabs: 0, gemini: 0, say: 0 };
for (const [i, l] of lines.entries()) {
  const mp3 = path.join(A, `n${i}.mp3`);
  let done = false;
  if (NARRATOR === "elevenlabs") { try { await elevenlabs(l.text, mp3); used.elevenlabs++; done = true; } catch (e) { console.log(`  line ${i}: ElevenLabs failed (${e.message.slice(0,50)}) -> Gemini`); } }
  if (!done && NARRATOR !== "say") { try { await tts(l.text, mp3); used.gemini++; done = true; } catch (e) { console.log(`  line ${i}: Gemini TTS failed (${e.message.slice(0,50)}) -> say`); } }
  if (!done) { const aiff = path.join(SCR, `hf-n${i}.aiff`); sh(`say -v Daniel -r 180 -o "${aiff}" ${JSON.stringify(l.text)}`); sh(`ffmpeg -y -v error -i "${aiff}" -codec:a libmp3lame -q:a 3 "${mp3}"`); used.say++; }
  l.d = dur(mp3); l.src = `assets/n${i}.mp3`;
}
console.log(`  narration: ${used.elevenlabs} ElevenLabs (${EL_MODEL}) · ${used.gemini} Gemini TTS · ${used.say} say`);

// --- captions (lower third), same moments ---
const caps = [
  [tJoin - 1.0, 6, "One link. No app. No wallet."],
  [tStart + 2.5, 8, "Rival train routed by IFM K2 Horizon — running locally"],
  [tAuc + 0.4, 9, "Contested track → 8-second second-price auction, settled on Solana"],
  [tAuc + 17, 7, "Dispatcher voice: Gemini"],
  [tEnd + 1.5, 10, `The room vs. one dispatcher: ${ratio ? ratio.toFixed(1) + "×" : "2–3×"} the delay`],
  [tRecap + 0.8, 6, "Run report: written by Grok"],
].map(([t, d, text]) => ({ c: toComp(t), d, text })).filter(x => x.c !== null && x.c + x.d <= mainEnd + 1);

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
const vid = (id, src, k, x, y, w, h) => `<video id="${id}" class="clip" data-start="${k.c.toFixed(2)}" data-duration="${k.d.toFixed(2)}" data-media-start="${k.m.toFixed(2)}" data-has-audio="false" src="${src}" muted playsinline style="position:absolute;left:${x}px;top:${y}px;width:${w}px;height:${h}px;object-fit:cover;border:1px solid #2A2438;border-radius:8px;background:#08070C"></video>`;
const mainClips = clips.map((k, i) => vid(`board${i}`, "assets/board.webm", k, 64, 100, 1392, 870) + vid(`phone${i}`, "assets/phone.webm", k, 1496, 113, 392, 848)).join("\n      ");
const expClip = EXP ? `<video id="explorer" class="clip" data-start="${mainEnd.toFixed(2)}" data-duration="${EXP}" data-media-start="0" data-has-audio="false" src="assets/explorer.webm" muted playsinline style="position:absolute;left:730px;top:70px;width:460px;height:996px;object-fit:cover;border:2px solid #E0A93F;border-radius:14px;background:#08070C"></video>
      <div class="clip cap" data-start="${mainEnd.toFixed(2)}" data-duration="${EXP}" style="top:auto;bottom:0">Every auction on Solana devnet — co-signed by your own train</div>` : "";
const capHtml = caps.map((x, i) => `<div id="cap${i}" class="clip cap" data-start="${x.c.toFixed(2)}" data-duration="${x.d}">${esc(x.text)}</div>`).join("\n      ");
const audHtml = lines.map((l, i) => `<audio id="narration-${i}" class="clip" data-start="${l.c.toFixed(2)}" data-duration="${(l.d + 0.2).toFixed(2)}" src="${l.src}" data-volume="1"></audio>`).join("\n      ");

const html = `<!doctype html>
<html lang="en" data-resolution="landscape">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=1920, height=1080" />
    <script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
    <style>
      *{margin:0;padding:0;box-sizing:border-box}
      html,body{width:1920px;height:1080px;overflow:hidden;background:#08070C}
      body{font-family:Georgia,"Times New Roman",serif;color:#F4EDDC}
      .clip{position:absolute;inset:0}
      .card{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:26px;text-align:center}
      .h1{font-size:92px;letter-spacing:.26em;text-transform:uppercase;color:#F0C462;line-height:1}
      .h2{font-size:34px;letter-spacing:.04em;color:#F4EDDC}
      .eyebrow{font-family:-apple-system,"Helvetica Neue",Arial,sans-serif;font-size:20px;letter-spacing:.24em;text-transform:uppercase;color:#8E8776}
      .rule{width:120px;height:3px;background:#E0A93F}
      .cap{top:auto;bottom:0;height:88px;padding:0 64px;display:flex;align-items:center;font-family:-apple-system,"Helvetica Neue",Arial,sans-serif;font-size:30px;letter-spacing:.02em;color:#F7DC98;background:linear-gradient(transparent,rgba(8,7,12,.92) 30%)}
      .frame{position:absolute;inset:18px;border:1px solid #211C2E;pointer-events:none}
      .lbl{position:absolute;top:66px;font-family:-apple-system,"Helvetica Neue",Arial,sans-serif;font-size:18px;letter-spacing:.24em;text-transform:uppercase;color:#8E8776}
    </style>
  </head>
  <body>
    <div id="root" data-composition-id="main" data-start="0" data-duration="120" data-width="1920" data-height="1080">
      <div id="title" class="clip" data-start="0" data-duration="${TITLE}">
        <div id="title-inner" class="card" style="position:absolute;inset:0">
          <div class="eyebrow">HackCMU 2026</div>
          <div id="title-h1" class="h1">Midnight Express</div>
          <div id="title-rule" class="rule"></div>
          <div id="title-h2" class="h2">Forty trains. One network. Not enough track.</div>
        </div>
      </div>

      <div id="stage" class="clip" data-start="${TITLE}" data-duration="${(mainEnd - TITLE).toFixed(2)}">
        <div class="frame"></div>
        <div class="lbl" style="left:64px">Dispatch board</div>
        <div class="lbl" style="left:1496px">One player's phone</div>
      </div>
      ${mainClips}
      ${capHtml}
      ${expClip}

      <div id="end" class="clip" data-start="${(120 - END).toFixed(2)}" data-duration="${END}">
        <div id="end-inner" class="card" style="position:absolute;inset:0">
          <div class="eyebrow">github.com/sraghav12/midnight-express</div>
          <div id="end-h1" class="h1" style="font-size:64px">Midnight Express</div>
          <div class="rule"></div>
          <div class="h2" style="color:#B0A791;font-size:26px">Solana · IFM K2 Horizon · Gemini · Grok · Vultr</div>
        </div>
      </div>

      ${audHtml}
    </div>
    <script>
      window.__timelines = window.__timelines || {};
      const tl = gsap.timeline({ paused: true });
      tl.from("#title-h1", { opacity: 0, y: 30, duration: 1.1 }, 0.2);
      tl.from("#title-h2", { opacity: 0, duration: 0.9 }, 1.0);
      tl.from("#title-rule", { scaleX: 0, duration: 0.8 }, 0.8);
      tl.to("#title-inner", { opacity: 0, duration: 0.6 }, ${TITLE - 0.6});
      tl.set("#title-inner", { opacity: 0 }, ${TITLE});
      ${caps.map((x, i) => `tl.from("#cap${i}", { opacity: 0, y: 20, duration: 0.5 }, ${x.c.toFixed(2)});`).join("\n      ")}
      tl.from("#end-h1", { opacity: 0, y: 20, duration: 1.0 }, ${(120 - END + 0.2).toFixed(2)});
      window.__timelines["main"] = tl;
    </script>
  </body>
</html>`;
fs.writeFileSync(path.join(PROJ, "index.html"), html);
console.log(`  composition: 120s | title ${TITLE}s | main ${TITLE}-${mainEnd.toFixed(1)}s (${clips.length} clip${clips.length>1?"s, jump-cut":""}) | explorer ${EXP}s | end ${END}s`);
console.log(`  narration ${lines.length} lines, captions ${caps.length}, footage ${boardLen.toFixed(1)}s (run ${tStart?.toFixed(1)}->${tEnd?.toFixed(1)}, ratio ${ratio})`);
