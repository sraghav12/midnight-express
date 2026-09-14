// Compose a share image (1920x1080) from the screenshots in public/img: the board large,
// two phone screens beside it, one caption line. For posts, slides, the README hero.
//   node tools/pitch/share-image.mjs [out.png]
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const OUT = process.argv[2] || path.join(ROOT, "midnight-express-share.png");
// A page built with setContent has no origin and may not load file:// assets, so inline them.
const dataUri = (file, mime) => `data:${mime};base64,${fs.readFileSync(file).toString("base64")}`;
const img = (f) => dataUri(path.join(ROOT, "public", "img", f), "image/jpeg");
const font = dataUri(path.join(ROOT, "public", "fonts", "cabin.woff2"), "font/woff2");

const html = `<!doctype html><html><head><meta charset="utf-8"><style>
@font-face{font-family:Cabin;src:url("${font}") format("woff2");font-weight:400 700}
html,body{margin:0;width:1920px;height:1080px;background:#F3EFE6;color:#1B1B1B;font-family:Cabin,"Gill Sans",sans-serif;overflow:hidden}
.wrap{position:absolute;inset:0;padding:48px 56px;display:grid;grid-template-columns:1136px 1fr;grid-template-rows:auto auto;align-content:center;gap:40px 40px}
.board{border:3px solid #1B1B1B;border-radius:8px;overflow:hidden;background:#fff;align-self:center}
.board img{display:block;width:100%;height:auto}
.phones{display:flex;gap:28px;align-items:center;justify-content:flex-start}
.phone{border:3px solid #1B1B1B;border-radius:14px;overflow:hidden;width:300px;background:#fff}
.phone img{display:block;width:100%;height:auto}
.cap{grid-column:1 / -1;display:flex;align-items:baseline;justify-content:space-between;gap:40px}
.cap h1{margin:0;font-size:44px;font-weight:700;letter-spacing:-.01em}
.cap p{margin:0;font-size:24px;color:#5B574F;font-weight:600}
.cap .url{font-size:22px;font-weight:700;color:#1B1B1B;white-space:nowrap;flex:0 0 auto}
.tag{display:inline-block;background:#E03A2F;color:#fff;font-weight:700;font-size:15px;letter-spacing:.04em;text-transform:uppercase;padding:4px 10px;border-radius:4px;vertical-align:middle;margin-left:14px;position:relative;top:-6px}
</style></head><body><div class="wrap">
  <div class="board"><img src="${img("board-contested.jpg")}"></div>
  <div class="phones">
    <div class="phone"><img src="${img("phone-bid.jpg")}"></div>
    <div class="phone"><img src="${img("phone-drive.jpg")}"></div>
  </div>
  <div class="cap">
    <div><h1>Midnight Express<span class="tag">Second-price auctions for contested track</span></h1>
      <p>Everyone scans one QR and drives a train. Too little track. When two trains want the same segment, both phones turn red for eight seconds and bid.</p></div>
    <div class="url">github.com/sraghav12/midnight-express</div>
  </div>
</div></body></html>`;

const b = await chromium.launch();
const page = await b.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
await page.setContent(html, { waitUntil: "load" });
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(300);
await page.screenshot({ path: OUT, type: "png" });
await b.close();
console.log("wrote", OUT);
