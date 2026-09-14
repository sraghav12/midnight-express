// Record a ~20 s native-video clip of the dispatch board during a contested auction.
// mp4 (H.264, yuv420p, 1920x1080, silent) -- what X and LinkedIn want uploaded directly.
//   node tools/pitch/clip.mjs http://localhost:8095 out.mp4      (BOT_NAMES=... optional)
import { chromium } from "playwright";
import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
const BASE = process.argv[2] || "http://localhost:8095";
const OUT = process.argv[3] || "midnight-express-clip.mp4";
const WS = BASE.replace(/^http/, "ws");
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "me-clip-"));
const names = process.env.BOT_NAMES || "Priya,Marcus,Jin,Amara,Tomás,Lena";
const bots = spawn("node", ["scripts/loadtest.js", "6", WS], { stdio: "ignore", env: { ...process.env, BOT_NAMES: names } });

const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1920, height: 1080 }, recordVideo: { dir, size: { width: 1920, height: 1080 } } });
const page = await ctx.newPage();
const t0 = Date.now();
await page.goto(`${BASE}/?mute`, { waitUntil: "networkidle" });
const txt = (sel) => page.evaluate((s) => document.querySelector(s)?.textContent?.trim() || "", sel);
let departed = null; const contests = [];
while (Date.now() - t0 < 70_000) {
  if (!departed && (await txt("#phase")) === "en route") { departed = Date.now(); console.log(`  departed @ ${((departed - t0) / 1000).toFixed(1)}s`); }
  if (departed && Date.now() - departed > 10_000 && (await page.locator("#aucList .auc").count()) > 0) contests.push((Date.now() - t0) / 1000);
  if (departed && Date.now() - departed > 45_000) break;
  await page.waitForTimeout(250);
}
const video = page.video();
await ctx.close(); await b.close(); bots.kill();
const webm = await video.path();
const firstContest = contests[0] ?? ((departed ?? t0) - t0) / 1000 + 12;
const start = Math.max(0, firstContest - 4);
console.log(`  first mid-run contest @ ${firstContest.toFixed(1)}s -> clip ${start.toFixed(1)}s +20s`);
execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-ss", start.toFixed(2), "-i", webm, "-t", "20",
  "-vf", "scale=1920:1080:flags=lanczos", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-preset", "medium", "-crf", "19", "-r", "30",
  "-movflags", "+faststart", "-an", OUT]);
fs.rmSync(dir, { recursive: true, force: true });
console.log("wrote", OUT);
