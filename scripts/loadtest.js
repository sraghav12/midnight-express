// Fake N phones against a running server. This is the G1 / 10-phone verification tool.
//   node scripts/loadtest.js [N] [wsUrl]
// e.g. node scripts/loadtest.js 20 wss://midnight.example.com
import WebSocket from "ws";

const N = Number(process.argv[2] || 10);
const BASE = process.argv[3] || "ws://localhost:8099";

const stats = { joined: 0, auctions: 0, bids: 0, settled: 0, arrived: 0, errors: 0, states: 0 };
const latencies = [];
let runEnded = null;

function spawn(i) {
  const ws = new WebSocket(`${BASE}/?role=player`);
  let me = null, lastState = 0;

  ws.on("open", () => ws.send(JSON.stringify({ t: "join", name: `Bot${i + 1}` })));
  ws.on("error", (e) => { stats.errors++; if (stats.errors < 3) console.error("  ws error:", e.message); });
  ws.on("message", (raw) => {
    const m = JSON.parse(raw);
    if (m.t === "welcome") { me = m.trainId; stats.joined++; ws.send(JSON.stringify({ t: "throttle", value: 1 })); }
    if (m.t === "state") {
      stats.states++;
      const now = Date.now();
      if (lastState) latencies.push(now - lastState);
      lastState = now;
    }
    if (m.t === "auction") {
      stats.auctions++;
      // bid a random slice of budget, like a real distracted human would
      const amt = Math.floor(Math.random() * 45);
      ws.send(JSON.stringify({ t: "bid", auctionId: m.auction.auctionId, amount: amt }));
      stats.bids++;
    }
    if (m.t === "settled") stats.settled++;
    if (m.t === "arrived" && m.trainId === me) stats.arrived++;
    if (m.t === "runEnd") runEnded = m.summary;
  });
  return ws;
}

const HTTP = BASE.replace(/^ws/, "http");
try {
  const h = await (await fetch(`${HTTP}/health`)).json();
  console.log(`server: phase=${h.phase} trains=${h.trains} joinable=${h.joinable}`);
} catch (e) {
  console.error(`cannot reach ${HTTP}/health -- is the server up on this port?`);
  process.exit(1);
}

console.log(`spawning ${N} clients against ${BASE} …`);
const clients = Array.from({ length: N }, (_, i) => spawn(i));

const t0 = Date.now();
const iv = setInterval(() => {
  if (runEnded || Date.now() - t0 > 100000) {
    clearInterval(iv);
    const p = (a, q) => a.length ? a.slice().sort((x, y) => x - y)[Math.floor(a.length * q)] : 0;
    if (!runEnded) console.log("\n!! run never ended -- server may be stuck in a previous run");
    console.log("\n================ LOAD TEST ================");
    console.log(` clients spawned : ${N}`);
    console.log(` joined ok       : ${stats.joined}`);
    console.log(` state frames    : ${stats.states}`);
    console.log(` broadcast gap   : p50 ${p(latencies,.5)}ms  p95 ${p(latencies,.95)}ms  max ${Math.max(...latencies,0)}ms`);
    console.log(` auctions seen   : ${stats.auctions}   bids sent: ${stats.bids}   settled: ${stats.settled}`);
    console.log(` arrived         : ${stats.arrived}/${N}`);
    console.log(` socket errors   : ${stats.errors}`);
    if (runEnded) {
      console.log(` run ticks       : ${runEnded.ticks}`);
      console.log(` auctions total  : ${runEnded.auctions}`);
      console.log(` swarm delay     : ${runEnded.scoreboard.humanSwarmDelay}`);
      console.log(` arrived total   : ${runEnded.scoreboard.arrivedCount}/${runEnded.scoreboard.totalCount}`);
    }
    console.log("===========================================");
    const ok = stats.joined === N && stats.errors === 0 && p(latencies,.95) < 400;
    console.log(ok ? "PASS" : "FAIL — investigate before the demo");
    clients.forEach((c) => c.close());
    process.exit(ok ? 0 : 1);
  }
}, 500);
