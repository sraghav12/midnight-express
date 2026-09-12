// Record a REAL run: the board (1440x900) and one real phone (390x844) in the same run,
// plus 3 bot phones for contention. Logs an event timeline so narration can be placed
// at the actual moments. Output: webm files + timeline.json in this directory.
import { chromium } from "playwright";
import WebSocket from "ws";
import fs from "node:fs";
const DIR = "/private/tmp/claude-501/-Users-sragh-Desktop-CMU-Sem-3-HackCMU/614ed03d-2ad0-4e91-a8eb-a0173b22e09c/scratchpad/video/";
const BASE = "http://localhost:8080";
const T0 = Date.now(); const tl = []; const mark = (k, extra={}) => { tl.push({ t: +((Date.now()-T0)/1000).toFixed(2), k, ...extra }); console.log(`  [${tl.at(-1).t.toString().padStart(6)}s] ${k} ${JSON.stringify(extra)}`); };

const browser = await chromium.launch();
const boardCtx = await browser.newContext({ viewport: { width: 1440, height: 900 }, recordVideo: { dir: DIR + "board", size: { width: 1440, height: 900 } } });
const phoneCtx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
  userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
  recordVideo: { dir: DIR + "phone", size: { width: 390, height: 844 } } });
const board = await boardCtx.newPage(); const phone = await phoneCtx.newPage();

// screen socket: know exactly when things happen
let ended = false, recap = null, receipt = null, firstAuction = null;
const ws = new WebSocket(BASE.replace("http","ws") + "/?role=screen");
ws.on("message", r => { const m = JSON.parse(r);
  if (m.t === "started") mark("run_started", { trains: m.trains });
  if (m.t === "auctionOpen" && !firstAuction) { firstAuction = true; mark("first_auction", { seg: m.auction.segment }); }
  if (m.t === "runEnd") { ended = true; mark("run_end", { ratio: +(m.summary.scoreboard.totalDelay/m.summary.baselineDelay).toFixed(2), arrived: m.summary.scoreboard.arrivedCount }); }
  if (m.t === "recap") { recap = m.text; mark("recap", { text: m.text }); }
  if (m.t === "receipt") { receipt = m.receipt; mark("receipt", { url: m.receipt?.explorerUrl }); } });

await board.goto(BASE + "/?mute"); mark("board_open");
await phone.goto(BASE + "/play"); mark("phone_open");
await phone.waitForTimeout(2500);
await phone.fill("#name", "Sraghav"); await phone.waitForTimeout(600);
await phone.click("#joinBtn"); mark("phone_joined");

// three more humans so the network is contested
const bots = ["Priya","Marcus","Wen"].map(n => { const w = new WebSocket(BASE.replace("http","ws") + "/?role=player");
  w.on("open", () => w.send(JSON.stringify({ t:"join", name:n })));
  w.on("message", r => { const m = JSON.parse(r); if (m.t === "auction") setTimeout(() => w.send(JSON.stringify({ t:"bid", auctionId:m.auction.auctionId, amount: 10+Math.floor(Math.random()*35) })), 1500+Math.random()*3000); });
  return w; });

// the recorded phone bids like a person: wait, then tap 50%
let bidsPlaced = 0;
const bidLoop = setInterval(async () => { try {
  const open = await phone.$eval("#auction", el => !el.classList.contains("hide")).catch(()=>false);
  if (open) { await phone.waitForTimeout(2200); await phone.click(".quick button:nth-child(3)"); bidsPlaced++; mark("phone_bid", { n: bidsPlaced }); await phone.waitForTimeout(6500); }
} catch {} }, 400);

// wait for the run to end (cap 3 min), then the scoreboard/recap/receipt
const tEnd = Date.now() + 180000; while (!ended && Date.now() < tEnd) await new Promise(r => setTimeout(r, 500));
clearInterval(bidLoop);
for (let i = 0; i < 24 && !(recap && receipt); i++) await new Promise(r => setTimeout(r, 500));
await board.waitForTimeout(7000);                      // let the replay play on camera
mark("phone_end_screen");
// the closing shot: tap the Solana link, capture the Explorer page in the phone context
const [popup] = await Promise.all([ phoneCtx.waitForEvent("page", { timeout: 15000 }).catch(() => null), phone.click("#explorer").catch(() => null) ]);
if (popup) { mark("explorer_opened"); await popup.waitForLoadState("domcontentloaded").catch(()=>{}); await popup.waitForTimeout(9000); mark("explorer_shown"); }
else mark("explorer_missing");
await board.waitForTimeout(1500);
mark("stop");
const bv = await board.video().path(), pv = await phone.video().path(); const ev = popup ? await popup.video().path() : null;
await boardCtx.close(); await phoneCtx.close(); await browser.close(); ws.close(); bots.forEach(b => b.close());
fs.writeFileSync(DIR + "timeline.json", JSON.stringify({ timeline: tl, files: { board: bv, phone: pv, explorer: ev } }, null, 2));
console.log("DONE", JSON.stringify({ board: bv, phone: pv, explorer: ev }));
process.exit(0);
