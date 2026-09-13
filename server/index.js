import "./env.js";   // MUST be first: sim/llm/agent read env at module load
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";
import QRCode from "qrcode";
import { Run, TICK_HZ } from "./sim.js";
import { networkPayload } from "./network.js";
import { ChainStub } from "./chain-stub.js";
import { SolanaMemoAdapter } from "../chain/solana-memo.js";
import { AnchorAdapter } from "../chain/anchor-adapter.js";
import { centralizedBaseline } from "./baseline.js";
import { AgentTrain, heuristicSteer, heuristicBid } from "./agent.js";
import { Dispatcher } from "./dispatcher.js";
import { resolveProvider, providerSync } from "./llm.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PUBLIC = path.join(__dirname, "..", "public");
const PORT = process.env.PORT || 8080;
const BROADCAST_EVERY = 2;           // 20Hz sim, 10Hz state broadcast

/** First non-internal IPv4. This is the address a phone on the same wifi can reach. */
function lanIP() {
  for (const ifaces of Object.values(os.networkInterfaces())) {
    for (const i of ifaces || []) {
      if (i.family === "IPv4" && !i.internal) return i.address;
    }
  }
  return null;
}

/**
 * What the QR encodes and what we print at boot.
 * PUBLIC_URL wins. Otherwise use the host the screen was opened with -- but if that
 * is localhost, substitute the LAN IP, because "localhost" on a phone means the phone.
 */
function joinURL(reqHost) {
  if (process.env.PUBLIC_URL) { const u = process.env.PUBLIC_URL.replace(/\/$/, ""); return /\/(play|p)$/.test(u) ? u : u + "/play"; }
  // A tunnel writes its URL here after boot, so the QR updates with no restart.
  try {
    const f = path.join(__dirname, "..", ".public-url");
    if (fs.existsSync(f)) {
      const u = fs.readFileSync(f, "utf8").trim();
      if (u.startsWith("http")) return u.replace(/\/$/, "") + "/play";
    }
  } catch {}
  const host = reqHost || `localhost:${PORT}`;
  if (/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host)) {
    const ip = lanIP();
    if (ip) return `http://${ip}:${PORT}/play`;
  }
  return `http://${host}/play`;
}

const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json",
               ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".svg": "image/svg+xml" };

// ------------------------------------------------------------------ http
const server = http.createServer((req, res) => {
  const url = req.url.split("?")[0];
  if (url === "/health") {
    res.writeHead(200, { "content-type": "application/json" });
    return res.end(JSON.stringify({ ok: true, phase: run.phase, trains: run.trains.size,
      tick: run.tick, joinable: run.phase !== "ended",
      chain: chain.status ? chain.status() : { label: "stub", enabled: false },
      llm: providerSync(), voice: process.env.DISPATCHER_PROVIDER || "same as brain",
      agent: grok ? grok.stats() : null }));
  }
  if (url === "/qr.png") {
    const target = joinURL(req.headers.host);
    return QRCode.toBuffer(target, { width: 560, margin: 1,
      color: { dark: "#0b0a10", light: "#efe6d2" } })
      .then((buf) => { res.writeHead(200, { "content-type": "image/png", "cache-control": "no-store" }); res.end(buf); })
      .catch(() => { res.writeHead(500); res.end("qr failed"); });
  }
  if (url === "/join-url") {
    const target = joinURL(req.headers.host);
    res.writeHead(200, { "content-type": "application/json" });
    return res.end(JSON.stringify({ url: target }));
  }
  let file = url === "/" ? "/screen.html" : url;
  if (url === "/play" || url === "/p") file = "/phone.html";
  if (url === "/how" || url === "/help" || url === "/rules") file = "/how.html";
  try { file = decodeURIComponent(file); } catch { res.writeHead(400); return res.end("bad path"); }
  // Static files are served from public/ only. Normalising against "/" first means
  // any number of leading ".." collapses away, and the prefix check is the backstop.
  const full = path.resolve(PUBLIC, "." + path.posix.normalize("/" + file));
  if (!full.startsWith(PUBLIC + path.sep)) { res.writeHead(404); return res.end("not found"); }
  fs.readFile(full, (err, data) => {
    if (err) { res.writeHead(404); return res.end("not found"); }
    res.writeHead(200, { "content-type": MIME[path.extname(full)] || "application/octet-stream" });
    res.end(data);
  });
});

// ------------------------------------------------------------------ state
const sockets = new Map();          // ws -> { trainId, role }
let receipt = null;

// CHAIN=memo -> real Solana devnet writes; anything else -> off-chain stub.
// The stub and the real adapter implement the same three methods, so the sim
// cannot tell them apart and a dead chain never stops a run.
const onReceipt = (r) => { receipt = r; broadcast({ t: "receipt", receipt: r }); };
const onAuctionSig = ({ auctionId, sig, explorerUrl }) => {
  const a = auctionSigs.get(auctionId);
  auctionSigs.set(auctionId, { sig, explorerUrl });
  for (const trainId of (auctionParticipants.get(auctionId) || [])) {
    sendToTrain(trainId, { t: "auctionSig", auctionId, sig, explorerUrl });
  }
};
const auctionSigs = new Map();
const auctionParticipants = new Map();

// CHAIN=anchor -> Anchor program + MagicBlock ER (needs the program deployed)
// CHAIN=memo   -> Memo receipts co-signed by the trains (live on devnet)
// otherwise    -> off-chain stub
const chain = process.env.CHAIN === "anchor" ? new AnchorAdapter({ onReceipt, onAuctionSig })
            : process.env.CHAIN === "memo"   ? new SolanaMemoAdapter({ onReceipt, onAuctionSig })
            : new ChainStub({ onReceipt });

// NEVER await this: a slow or dead RPC must not delay the server from listening.
// The adapter starts disabled and flips itself on when funding confirms.
if (chain.init) chain.init().catch((e) => console.warn(`[chain] init failed: ${e.message}`));

// Decide the AI backend once, in the background. Never blocks listen().
resolveProvider()
  .then((p) => console.log(`[llm] brain: ${p.label}`))
  .catch(() => console.log("[llm] brain: heuristic only"));

let run = newRun();
let grok = null;            // the named rival, LLM-backed when a key is present
let dispatcher = null;      // the voice
let fillerBrains = [];      // the rest of the freight: heuristic only

function newRun() {
  receipt = null;
  return new Run({ chain, onEvent: handleSimEvent });
}

/** Give the agent trains their brains. The first one is the rival; it gets a name. */
function wireBrains() {
  chain.startRun?.(run.runId, [...run.trains.values()].map((t) => ({ id: t.id, name: t.name })));
  dispatcher = new Dispatcher({ run, say: (text, meta = {}) => broadcast({ t: meta.kind === "recap" ? "recap" : "say", text }, "screen") });
  dispatcher.onDeparture(run.trains.size);
  grok = null; fillerBrains = [];
  const agents = [...run.trains.values()].filter((t) => t.isAgent);
  if (!agents.length) return;
  // Name the rival after the brain actually driving it -- never a hardcoded guess.
  const p = providerSync();
  agents[0].name = p.rivalName || "Dispatcher";
  grok = new AgentTrain({ run, trainId: agents[0].id });
  fillerBrains = agents.slice(1).map((t) => t.id);
  console.log(`[agent] rival "${agents[0].name}" wired (${p.label}), ${fillerBrains.length} freight`);
}

/** Agents bid the moment an auction opens -- same API a phone uses. */
function agentsBid(auction) {
  for (const b of auction.bidders) {
    const t = run.trains.get(b.trainId);
    if (!t?.isAgent) continue;
    const live = run.auctions.get(auction.auctionId);
    if (!live) continue;
    if (grok && b.trainId === grok.trainId) {
      grok.decideBid(live)
        .then((amt) => run.placeBid(b.trainId, auction.auctionId, amt))
        .catch(() => run.placeBid(b.trainId, auction.auctionId, heuristicBid(run, t, live)));
    } else {
      run.placeBid(b.trainId, auction.auctionId, heuristicBid(run, t, live));
    }
  }
}

function handleSimEvent(ev) {
  if (ev.t === "auction") {
    agentsBid(ev.auction);
    dispatcher?.onAuction(ev.auction);
    auctionParticipants.set(ev.auction.auctionId, ev.auction.bidders.map((b) => b.trainId));
    // buzz only the bidders
    for (const b of ev.auction.bidders) sendToTrain(b.trainId, { t: "auction", auction: ev.auction });
    broadcast({ t: "auctionOpen", auction: ev.auction }, "screen");
    return;
  }
  if (ev.t === "settled") dispatcher?.onSettled(ev.settlement, run);
  if (ev.t === "arrived") dispatcher?.onArrived(run.trains.get(ev.trainId) || {});
  if (ev.t === "runEnd") {
    let base = {};
    try { base = centralizedBaseline(ev.summary, { scarcity: run.scarcity }); }
    catch (e) { console.error("baseline failed:", e.message); }
    const rival = grok ? run.trains.get(grok.trainId) : null;
    const full = { ...ev.summary, ...base,
      rival: rival ? { id: rival.id, name: rival.name, delayTicks: Math.round(rival.delayTicks) } : null };
    dispatcher?.onRunEnd(full);
    broadcast({ t: "runEnd", summary: full }, "screen");
    // phones get everything except the two telemetry logs (hundreds of KB on cellular)
    const { log, baselineLog, ...light } = full;
    broadcast({ t: "runEnd", summary: light }, "player");
    scheduleReset();
    return;
  }
  broadcast(ev);
}

// ------------------------------------------------------------------ ws
const wss = new WebSocketServer({ server });

wss.on("connection", (ws, req) => {
  const role = new URL(req.url, "http://x").searchParams.get("role") === "screen" ? "screen" : "player";
  sockets.set(ws, { trainId: null, role });
  ws.isAlive = true;
  ws.on("pong", () => { ws.isAlive = true; });

  send(ws, { t: "hello", role, phase: run.phase, network: networkPayload(), tickHz: TICK_HZ,
             chain: chain.status ? chain.status() : { label: "stub", enabled: false } });

  ws.on("message", (raw) => {
    let msg; try { msg = JSON.parse(raw); } catch { return; }
    const meta = sockets.get(ws);
    if (!meta) return;

    switch (msg.t) {
      case "join": {
        if (meta.trainId) return;
        if (run.phase === "ended") resetRun();
        const train = run.addTrain({ name: (msg.name || "").slice(0, 16) });
        meta.trainId = train.id;
        send(ws, {
          t: "welcome", trainId: train.id, name: train.name, color: train.color,
          origin: train.origin, destination: train.destination, budget: train.budget,
          network: networkPayload(),
        });
        if (run.phase === "lobby" && run.trains.size >= 1) maybeAutoStart();
        break;
      }
      case "steer":    run.setSteer(meta.trainId, msg.toNode); break;
      case "throttle": run.setThrottle(meta.trainId, msg.value); break;
      case "bid":      run.placeBid(meta.trainId, msg.auctionId, msg.amount); break;
      // Lifecycle controls belong to the dispatch board. Without the role check any
      // phone could end everyone's run with one forged message.
      case "start":    if (meta.role === "screen" && run.phase === "lobby") { run.start(); wireBrains(); } break;
      case "reset":    if (meta.role === "screen") resetRun(); break;
      default: break;
    }
  });

  ws.on("close", () => sockets.delete(ws));
});

const SCOREBOARD_HOLD_MS = Number(process.env.SCOREBOARD_HOLD_MS || 20000);
let resetTimer = null;

/** Hold the scoreboard so people can read it, then open a fresh lobby. */
function scheduleReset() {
  clearTimeout(resetTimer);
  resetTimer = setTimeout(resetRun, SCOREBOARD_HOLD_MS);
}

function resetRun() {
  clearTimeout(resetTimer); resetTimer = null;
  clearTimeout(autoStartTimer); autoStartTimer = null;
  run = newRun();
  auctionSigs.clear();
  auctionParticipants.clear();
  for (const meta of sockets.values()) meta.trainId = null;   // everyone re-boards
  broadcast({ t: "reset" });
  console.log("run reset -- lobby open");
}

let autoStartTimer = null;
function maybeAutoStart() {
  if (autoStartTimer || run.phase !== "lobby") return;
  autoStartTimer = setTimeout(() => {
    autoStartTimer = null;
    if (run.phase === "lobby") { run.start(); wireBrains(); }
  }, 8000);
}

function send(ws, obj) { if (ws.readyState === 1) ws.send(JSON.stringify(obj)); }
function broadcast(obj, roleFilter = null) {
  const s = JSON.stringify(obj);
  for (const [ws, meta] of sockets) {
    if (roleFilter && meta.role !== roleFilter) continue;
    if (ws.readyState === 1) ws.send(s);
  }
}
function sendToTrain(trainId, obj) {
  for (const [ws, meta] of sockets) if (meta.trainId === trainId) send(ws, obj);
}

// ------------------------------------------------------------------ loop
let frame = 0;
const STEER_EVERY = 12;      // ~0.6s. Agents re-route far less often than they could.

function driveAgents() {
  if (run.phase !== "running") return;
  for (const id of fillerBrains) {
    const t = run.trains.get(id);
    if (!t || t.state === "arrived") continue;
    const to = heuristicSteer(run, t);
    if (to) run.setSteer(id, to);
  }
  if (grok) {
    const t = grok.train;
    if (t && t.state !== "arrived" && !grok.busy) {
      // One reasoning call per junction, never overlapping, never awaited by the
      // tick. At a node, or in transit with no pre-selection yet, ask the model
      // which way to go at the junction ahead. Everything else is the heuristic.
      const junction = run.junctionNode(t);
      const undecided = t.state !== "on_segment" || !t.steer;
      if (undecided && grok.lastJunction !== junction) {
        grok.lastJunction = junction;
        grok.busy = true;
        grok.decideSteer()
          .then((to) => { if (to) run.setSteer(grok.trainId, to); })
          .catch(() => {})
          .finally(() => { grok.busy = false; });
      }
    }
  }
}

setInterval(() => {
  if (frame % STEER_EVERY === 0) driveAgents();
  if (frame % 60 === 0) dispatcher?.tick();
  run.step();
  if (++frame % BROADCAST_EVERY === 0 && run.phase === "running") broadcast(run.stateView());
}, 1000 / TICK_HZ);

// drop dead sockets so a flaky phone never wedges the room
setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) { ws.terminate(); continue; }
    ws.isAlive = false; ws.ping();
  }
}, 15000);

server.listen(PORT, "0.0.0.0", () => {
  const ip = lanIP();
  console.log("");
  console.log("  MIDNIGHT EXPRESS");
  console.log("  ---------------------------------------------------------");
  console.log(`  screen (this laptop)   http://localhost:${PORT}/`);
  if (ip) {
    console.log(`  phone  (same wifi)     http://${ip}:${PORT}/play`);
  } else {
    console.log("  phone                  NO LAN IP FOUND -- are you online?");
  }
  if (process.env.PUBLIC_URL) {
    console.log(`  QR encodes             ${process.env.PUBLIC_URL}`);
  } else {
    console.log(`  QR encodes             ${ip ? `http://${ip}:${PORT}/play` : "localhost (BROKEN on phones)"}`);
    console.log("");
    console.log("  NOTE: localhost does NOT work on a phone -- it means the phone itself.");
    console.log("        Same-wifi demo  -> use the phone URL above.");
    console.log("        Real demo       -> set PUBLIC_URL to your public https URL.");
  }
  console.log("  ---------------------------------------------------------");
  console.log("");
});
