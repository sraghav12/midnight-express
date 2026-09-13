// End to end: boot the real server, talk to it over HTTP and WebSocket like the
// board and a phone do, and watch one short run through to the scoreboard.
import { spawn } from "node:child_process";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import WebSocket from "ws";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 18000 + Math.floor(Math.random() * 20000);
const HTTP = `http://127.0.0.1:${PORT}`;
const WS = `ws://127.0.0.1:${PORT}`;
let proc, logs = "";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

before(async () => {
  proc = spawn(process.execPath, ["server/index.js"], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(PORT), LLM_PROVIDER: "none", DISPATCHER_MODE: "off", CHAIN: "",
           RUN_SECONDS: "6", AUCTION_SECONDS: "1", MIN_TRAFFIC: "4", SCARCITY: "2", SCOREBOARD_HOLD_MS: "500" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  proc.stdout.on("data", (d) => { logs += d; });
  proc.stderr.on("data", (d) => { logs += d; });
  const t0 = Date.now();
  while (Date.now() - t0 < 8000) {
    try { const r = await fetch(`${HTTP}/health`); if (r.ok) return; } catch {}
    await sleep(100);
  }
  throw new Error(`server did not come up on ${PORT}\n${logs}`);
});
after(() => { proc?.kill(); });

/** A test client that can await the first message matching a predicate. */
function client(role) {
  const ws = new WebSocket(`${WS}/?role=${role}`);
  const inbox = [], waiters = [];
  ws.on("message", (raw) => {
    const m = JSON.parse(raw); inbox.push(m);
    for (const w of [...waiters]) if (w.pred(m)) { waiters.splice(waiters.indexOf(w), 1); w.resolve(m); }
  });
  const next = (pred, ms = 5000) => new Promise((resolve, reject) => {
    const hit = inbox.find(pred); if (hit) return resolve(hit);
    const w = { pred, resolve }; waiters.push(w);
    setTimeout(() => { const i = waiters.indexOf(w); if (i >= 0) { waiters.splice(i, 1); reject(new Error(`timed out waiting for ${pred}`)); } }, ms);
  });
  return { ws, inbox, next, send: (o) => ws.send(JSON.stringify(o)),
           open: new Promise((r) => ws.on("open", r)), close: () => ws.close() };
}

/** Raw request, so the path is sent exactly as written (fetch would normalise ".." away). */
const raw = (p) => new Promise((resolve, reject) => {
  http.get({ host: "127.0.0.1", port: PORT, path: p }, (res) => {
    let body = ""; res.on("data", (d) => { body += d; }); res.on("end", () => resolve({ status: res.statusCode, body, type: res.headers["content-type"] }));
  }).on("error", reject);
});

test("/health describes the stub chain and the heuristic brain", async () => {
  const j = await (await fetch(`${HTTP}/health`)).json();
  assert.equal(j.ok, true);
  assert.equal(j.phase, "lobby");
  assert.equal(j.joinable, true);
  assert.deepEqual(j.chain, { label: "stub", enabled: false });
  assert.equal(j.llm.provider, "none");
});

test("the board, the phone, the rules, the QR and the join URL are all served", async () => {
  const board = await raw("/");     assert.equal(board.status, 200); assert.match(board.type, /text\/html/); assert.match(board.body, /Dispatch Board/);
  const phone = await raw("/play"); assert.equal(phone.status, 200); assert.match(phone.body, /Board the train|joinBtn/);
  const how = await raw("/how");    assert.equal(how.status, 200);   assert.match(how.type, /text\/html/);
  const css = await raw("/tokens.css"); assert.equal(css.status, 200); assert.match(css.type, /text\/css/);
  const qr = await fetch(`${HTTP}/qr.png`); assert.equal(qr.status, 200); assert.equal(qr.headers.get("content-type"), "image/png");
  const ju = await (await fetch(`${HTTP}/join-url`)).json(); assert.match(ju.url, /^http.*\/play$/);
  assert.equal((await raw("/nope.html")).status, 404);
});

test("paths outside public/ are refused, encoded or not", async () => {
  for (const p of ["/../server/index.js", "/../../etc/passwd", "/%2e%2e/server/index.js", "/..%2Fserver%2Findex.js", "/public/../server/index.js"]) {
    const r = await raw(p);
    assert.equal(r.status, 404, p);
    assert.doesNotMatch(r.body, /WebSocketServer|root:/, `${p} leaked file contents`);
  }
  assert.equal((await raw("/%ZZ")).status, 400, "malformed percent-encoding");
});

test("a phone boards, only the board can start, the run plays to a like-for-like scoreboard, then the lobby reopens", async () => {
  const screen = client("screen"), phone = client("player");
  await Promise.all([screen.open, phone.open]);

  const hello = await phone.next((m) => m.t === "hello");
  assert.equal(hello.role, "player"); assert.equal(hello.tickHz, 20);
  assert.equal(hello.network.segments.length, 17); assert.equal(hello.chain.label, "stub");
  assert.equal((await screen.next((m) => m.t === "hello")).role, "screen");

  phone.send({ t: "join", name: "Tester-with-a-very-long-name" });
  const w = await phone.next((m) => m.t === "welcome");
  assert.equal(w.name, "Tester-with-a-ve", "names are capped at 16 chars");
  assert.equal(w.budget, 100); assert.ok(w.trainId && w.origin && w.destination);

  phone.send({ t: "start" });
  await sleep(300);
  assert.equal((await (await fetch(`${HTTP}/health`)).json()).phase, "lobby", "a phone cannot start the run");

  screen.send({ t: "start" });
  const started = await screen.next((m) => m.t === "started");
  assert.equal(started.trains, 4, "topped up to MIN_TRAFFIC");
  const state = await screen.next((m) => m.t === "state" && m.phase === "running");
  const names = state.trains.map((t) => t.name);
  assert.ok(names.includes("Tester-with-a-ve"));
  assert.ok(names.includes("Dispatcher"), `the rival is named after its (heuristic) brain: ${names}`);
  assert.equal(state.trains.filter((t) => t.isAgent).length, 3);
  assert.equal((await (await fetch(`${HTTP}/health`)).json()).agent.usingLLM, false);

  const end = await screen.next((m) => m.t === "runEnd", 12000);
  const s = end.summary;
  assert.equal(s.scoreboard.totalCount, 4);
  assert.equal(typeof s.baselineDelay, "number");
  assert.ok(Array.isArray(s.log) && s.log.length > 0, "the board gets the replay log");
  assert.ok(Array.isArray(s.baselineLog));
  assert.equal(s.rival.name, "Dispatcher");
  const phoneEnd = await phone.next((m) => m.t === "runEnd", 2000);
  assert.equal(phoneEnd.summary.log, undefined, "phones do not get the telemetry logs");
  assert.ok(phoneEnd.summary.trains.some((t) => t.id === w.trainId));

  await screen.next((m) => m.t === "reset", 3000);
  assert.equal((await (await fetch(`${HTTP}/health`)).json()).phase, "lobby");
  const late = client("player"); await late.open;
  late.send({ t: "join", name: "Second" });
  assert.equal((await late.next((m) => m.t === "welcome")).name, "Second");

  late.send({ t: "reset" });
  await sleep(200);
  assert.equal((await (await fetch(`${HTTP}/health`)).json()).trains, 1, "a phone cannot reset the room");
  screen.close(); phone.close(); late.close();
});
