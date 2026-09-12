// Hold a websocket open for 60s and report drops. Used by g1-check.sh.
import WebSocket from "ws";
const url = process.argv[2];
const ws = new WebSocket(`${url}/?role=screen`);
let frames = 0, t0 = Date.now(), closed = false;
ws.on("open",   () => console.log("  open"));
ws.on("message",() => frames++);
ws.on("error",  (e) => { console.log("  ERROR", e.message); process.exit(1); });
ws.on("close",  () => { closed = true; console.log(`  CLOSED after ${((Date.now()-t0)/1000).toFixed(1)}s`); process.exit(1); });
setTimeout(() => {
  console.log(`  held 60.0s, ${frames} frames, drops: ${closed ? "YES" : "none"}`);
  console.log(closed ? "  G1 FAIL" : "  G1 PASS (laptop leg)");
  process.exit(closed ? 1 : 0);
}, 60000);
