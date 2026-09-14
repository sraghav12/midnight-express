// LinkedIn document post: an 8-slide square PDF carousel in the game's own design.
//   node tools/pitch/carousel.mjs out.pdf
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const OUT = process.argv[2] || path.join(ROOT, "midnight-express-carousel.pdf");
const dataUri = (file, mime) => `data:${mime};base64,${fs.readFileSync(file).toString("base64")}`;
const img = (f) => dataUri(path.join(ROOT, "public", "img", f), "image/jpeg");
const font = dataUri(path.join(ROOT, "public", "fonts", "cabin.woff2"), "font/woff2");

const slides = [
`<div class="s hook">
  <div class="k">Midnight Express · HackCMU 2026</div>
  <h1>I built a game that is secretly a market.</h1>
  <p class="lead">It lost at the hackathon. Then it taught me my own headline number was wrong.</p>
  <div class="shot wide"><img src="${img("board-run.jpg")}"></div>
  <div class="foot"><span>1 / 8</span><span>swipe →</span></div>
</div>`,
`<div class="s">
  <div class="k">The game</div>
  <h2>Everyone scans one QR.<br>Everyone gets a train.<br>There isn't enough track.</h2>
  <div class="row">
    <ul class="big">
      <li>Two trains want the same segment.</li>
      <li>Both phones turn <b class="red">red</b> for eight seconds.</li>
      <li>Sealed bid. Highest wins the track.</li>
      <li>No app, no wallet, no signup.</li>
    </ul>
    <div class="shot phone"><img src="${img("phone-bid.jpg")}"></div>
  </div>
  <div class="foot"><span>2 / 8</span></div>
</div>`,
`<div class="s">
  <div class="k">The mechanism</div>
  <h2>Second price.</h2>
  <p class="lead">The winner pays the <b>second-highest</b> bid, not its own. That payment is split among the losers as compensation for waiting.</p>
  <div class="callout">So bidding what the track is truly worth to you is always your best move. Nobody gains by lying. (Vickrey, 1961.)</div>
  <p class="lead dim">Rail slots, landing slots, road pricing, GPU scheduling: contested infrastructure is allocated today by queues and central authorities. This is a live, playable alternative.</p>
  <div class="foot"><span>3 / 8</span></div>
</div>`,
`<div class="s">
  <div class="k">The AI</div>
  <h2>One train is a language model.<br>A player, not a chatbot.</h2>
  <ul class="big">
    <li>0.9B parameters, running on my laptop. No key, no network.</li>
    <li>It chooses the route at every junction. One bounded reasoning call, parsed defensively, never awaited by the 20 Hz tick.</li>
    <li>A calibrated heuristic sits underneath. If the model is slow, wrong or dead, the game is identical.</li>
  </ul>
  <div class="callout">What a 0.9B model can decide: a choice among 2–5 options, with reasoning on.<br>What it can't: an open-ended number. Asked for a bid, it sometimes says 0.</div>
  <div class="foot"><span>4 / 8</span></div>
</div>`,
`<div class="s">
  <div class="k">The scoreboard</div>
  <h2>Then the room is measured against one central dispatcher with full information.</h2>
  <div class="shot wide"><img src="${img("board-score.jpg")}"></div>
  <p class="lead"><b>2.7× to 5×</b> the total delay, depending on how tight the track is. That gap is the price of everyone acting in their own interest.</p>
  <div class="foot"><span>5 / 8</span></div>
</div>`,
`<div class="s">
  <div class="k">The benchmark</div>
  <h2>Then I built a benchmark.<br>It contradicted me.</h2>
  <table>
    <tr><th>Subject policy</th><th>Mean delay</th><th>vs idle</th></tr>
    <tr><td>Idle player (bids 0)</td><td>24.7 s</td><td>—</td></tr>
    <tr><td>Bids 30 % of budget</td><td>17.7 s</td><td>−28 %</td></tr>
    <tr><td>Bids 50 %</td><td>13.8 s</td><td>−44 %</td></tr>
    <tr><td>All-in every time</td><td>12.3 s</td><td>−50 %</td></tr>
    <tr><td>Rival: smart routing only</td><td>22.4 s</td><td>−9 %</td></tr>
    <tr class="hi"><td>Rival: routing + true-value bid</td><td>11.5 s</td><td>−53 %</td></tr>
  </table>
  <div class="callout">I had claimed the "smart" rival beat everything by 48 %. It wins, but <b>all-in is within 7 %</b>. Second price makes aggression cheap when budgets never bind. 90 deterministic games, reproducible to the tick.</div>
  <div class="foot"><span>6 / 8</span></div>
</div>`,
`<div class="s">
  <div class="k">What hardening it taught me</div>
  <ul class="big">
    <li>A deadlock nobody hit at the hackathon: re-steer during an auction and a segment stayed "occupied" forever. Found by reading the code cold. Now an invariant checked after every tick.</li>
    <li>With reasoning off, the model echoed the prompt and made <b>0 valid decisions in 123 calls</b>. A counter on the health endpoint was the only tell. Count what lands.</li>
    <li>Routing is worth 79 % in a room of six and 1 % in a room of sixteen. Bidding is the reverse. Ablate before you claim.</li>
    <li>"The key is set" means nothing until the consuming process prints that it sees it.</li>
  </ul>
  <div class="foot"><span>7 / 8</span></div>
</div>`,
`<div class="s cta">
  <div class="k">Try it</div>
  <h2>Runs in one minute.<br>Zero keys.</h2>
  <pre>git clone https://github.com/sraghav12/midnight-express
cd midnight-express &amp;&amp; npm install &amp;&amp; npm start</pre>
  <p class="lead">Board on the laptop, phones on the LAN URL it prints. Point it at Ollama and the rival gets a brain.</p>
  <div class="url">github.com/sraghav12/midnight-express</div>
  <div class="callout">If you work on mechanism design, multi-agent systems, or small local models as players: where am I wrong? Tell me in the comments.</div>
  <div class="foot"><span>8 / 8</span></div>
</div>`,
];

const html = `<!doctype html><html><head><meta charset="utf-8"><style>
@font-face{font-family:Cabin;src:url("${font}") format("woff2");font-weight:400 700}
@page{size:1080px 1080px;margin:0}
html,body{margin:0;padding:0;background:#F3EFE6;color:#1B1B1B;font-family:Cabin,"Gill Sans",sans-serif;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.s{width:1080px;height:1080px;box-sizing:border-box;padding:72px 76px 64px;position:relative;page-break-after:always;display:flex;flex-direction:column;gap:26px;background:#F3EFE6;overflow:hidden}
.s:last-child{page-break-after:auto}
.k{font-size:20px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:#5B574F}
h1{margin:0;font-size:78px;line-height:1.02;font-weight:700;letter-spacing:-.015em}
h2{margin:0;font-size:56px;line-height:1.08;font-weight:700;letter-spacing:-.01em}
.lead{margin:0;font-size:30px;line-height:1.35;color:#1B1B1B}
.lead.dim{color:#5B574F}
.red{color:#E03A2F}
ul.big{margin:0;padding:0;list-style:none;display:flex;flex-direction:column;gap:18px}
ul.big li{font-size:29px;line-height:1.32;padding-left:34px;position:relative}
ul.big li::before{content:"";position:absolute;left:0;top:14px;width:16px;height:16px;border-radius:50%;background:#fff;border:3px solid #1B1B1B;box-sizing:border-box}
.callout{background:#fff;border:3px solid #1B1B1B;border-radius:8px;padding:22px 26px;font-size:27px;line-height:1.35}
.shot{border:3px solid #1B1B1B;border-radius:8px;overflow:hidden;background:#fff}
.shot img{display:block;width:100%;height:auto}
.shot.wide{margin-top:auto}
.row{display:flex;gap:36px;align-items:flex-start}
.row ul.big{flex:1;padding-top:10px}
.shot.phone{width:300px;flex:0 0 auto}
table{border-collapse:collapse;width:100%;font-size:26px}
th,td{padding:12px 14px;border-bottom:2px solid #D9D3C5;text-align:left}
th{font-size:20px;text-transform:uppercase;letter-spacing:.04em;color:#5B574F;border-bottom:3px solid #1B1B1B}
td:nth-child(2),td:nth-child(3),th:nth-child(2),th:nth-child(3){text-align:right;font-variant-numeric:tabular-nums}
tr.hi td{font-weight:700;background:#fff}
pre{margin:0;background:#1B1B1B;color:#F3EFE6;padding:24px 28px;border-radius:8px;font-size:24px;line-height:1.5;font-family:ui-monospace,Menlo,monospace;white-space:pre-wrap}
.url{font-size:38px;font-weight:700}
.foot{position:absolute;left:76px;right:76px;bottom:40px;display:flex;justify-content:space-between;font-size:20px;font-weight:700;color:#8E897E;text-transform:uppercase;letter-spacing:.04em}
.hook h1{margin-top:6px}
.cta h2{color:#1B1B1B}
</style></head><body>${slides.join("\n")}</body></html>`;

const b = await chromium.launch();
const page = await b.newPage({ viewport: { width: 1080, height: 1080 } });
await page.setContent(html, { waitUntil: "load" });
await page.evaluate(() => document.fonts.ready);
await page.pdf({ path: OUT, width: "1080px", height: "1080px", printBackground: true, preferCSSPageSize: true, margin: { top: 0, right: 0, bottom: 0, left: 0 } });
await b.close();
console.log("wrote", OUT);
