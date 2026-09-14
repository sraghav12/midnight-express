// Captures real screenshots for the how-to-play page from an isolated server.
// usage: node tools/pitch/howto-shots.mjs http://localhost:8099 public/img   (BOT_NAMES=Priya,Marcus,... for named bots)
import { chromium } from "playwright";
import { spawn } from "node:child_process";
const BASE = process.argv[2] || "http://localhost:8099";
const OUT  = process.argv[3] || "public/img";
const WS   = BASE.replace(/^http/, "ws");
const log  = (...a) => console.log("  " + a.join(" "));
const bots = spawn("node", ["scripts/loadtest.js", "6", WS], { stdio: "ignore" });
const b = await chromium.launch();
const board = await b.newPage({ viewport: { width: 1920, height: 1080 } });
await board.goto(`${BASE}/?mute`, { waitUntil: "networkidle" });
const phone = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
await phone.goto(`${BASE}/play`, { waitUntil: "networkidle" });
await phone.fill("#name", "You");
await phone.getByText("Board the train", { exact: true }).click();
const t0 = Date.now(); const shots = {}; const shot = async (p, name) => { if (shots[name]) return; shots[name] = true;
  await p.screenshot({ path: `${OUT}/${name}.jpg`, type: "jpeg", quality: 84 }); log(`${name}.jpg @ ${((Date.now()-t0)/1000).toFixed(0)}s`); };
const vis = (p, sel) => p.evaluate(s => { const e = document.querySelector(s); return !!e && e.offsetParent !== null && e.getClientRects().length > 0; }, sel);
const txt = (p, sel) => p.evaluate(s => document.querySelector(s)?.textContent?.trim() || "", sel);
let departed = 0;
while (Date.now() - t0 < 270_000) {
  const phase = await txt(board, "#phase");
  if (!departed && phase === "en route") { departed = Date.now(); log("departed"); }
  if (departed && !shots["phone-drive"] && Date.now() - departed > 6000 && (await phone.evaluate(() => document.querySelector("#auction")?.classList.contains("hide") && document.querySelector("#steerWrap")?.offsetParent !== null && document.querySelectorAll("#steerWrap button").length > 0))) await shot(phone, "phone-drive");
  if (departed && !shots["board-run"] && Date.now() - departed > 30_000) await shot(board, "board-run");
  // not the departure pile-up: wait for a contest once the trains have spread out
  if (departed && !shots["board-contested"] && Date.now() - departed > 12_000 && (await board.locator("#aucList .auc").count()) > 0) { await board.waitForTimeout(400); await shot(board, "board-contested"); }
  if (!shots["phone-bid"] && (await phone.evaluate(() => { const els=[...document.querySelectorAll("*")].filter(e=>e.children.length===0&&/Track contested/.test(e.textContent)); return els.some(e=>e.offsetParent!==null); }))) { await phone.waitForTimeout(700); await shot(phone, "phone-bid"); }
  const end = await txt(phone, "#endTitle"); if (!shots["phone-end"] && (end === "Arrived" || end === "Stranded") && await vis(phone, "#endTitle")) { await phone.waitForTimeout(600); await shot(phone, "phone-end"); }
  if (!shots["board-score"] && (await txt(board, "#verdict")).length > 0) { await board.waitForTimeout(2500); await shot(board, "board-score"); }
  if (shots["board-score"] && shots["phone-end"]) break;
  await board.waitForTimeout(500);
}
log("captured:", Object.keys(shots).join(", ") || "nothing");
bots.kill(); await b.close();
