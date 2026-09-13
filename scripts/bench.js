#!/usr/bin/env node
/**
 * Policy evaluation harness. Headless, deterministic, no server, no model, no keys.
 *
 *   node scripts/bench.js                 # every subject policy vs a mixed room
 *   node scripts/bench.js --sweep         # aggression sweep for the true-value rule
 *   node scripts/bench.js --room 16       # bigger room (default 10)
 *   node scripts/bench.js --scarcity 7    # venue pacing (default 3: same contention, faster)
 *   node scripts/bench.js --json          # machine-readable
 *
 * Method. A room of ROOM trains on the same under-built network. One train is the
 * SUBJECT, running the policy under test. The other ROOM-1 are opponents that cycle
 * through five fixed human-like bidding styles (5% / 15% / 30% / 50% / 100% of budget)
 * with shortest-path routing -- the way an idle or distracted player behaves. The
 * subject is rotated through every boarding slot (the slot decides origin and
 * destination), so the number reported is its mean over ROOM runs. Everything else --
 * routing, tie-breaks, pacing -- is identical, and the sim has no randomness, so the
 * table is reproducible to the tick.
 *
 * "Room / central" is the run's total delay divided by what one centralized dispatcher
 * with full information achieves on the identical fleet -- the gap the scoreboard shows.
 */
import { playHeadless, byName } from "../server/headless.js";
import { TICK_HZ } from "../server/sim.js";

const args = process.argv.slice(2);
const flag = (name, def) => { const i = args.indexOf(`--${name}`); return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : def; };
const ROOM = Number(flag("room", 10));
const SCARCITY = Number(flag("scarcity", 3));
const JSON_OUT = args.includes("--json");
const SWEEP = args.includes("--sweep");

const OPPONENTS = ["timid", "casual", "keen", "sharp", "allin"];

const SUBJECTS = {
  "default (idle player)":        { bid: "zero",      steer: "shortest" },
  "timid  (bids 5%)":             { bid: "timid",     steer: "shortest" },
  "casual (bids 15%)":            { bid: "casual",    steer: "shortest" },
  "keen   (bids 30%)":            { bid: "keen",      steer: "shortest" },
  "sharp  (bids 50%)":            { bid: "sharp",     steer: "shortest" },
  "all-in (bids 100%)":           { bid: "allin",     steer: "shortest" },
  "rival: routing only":          { bid: "zero",      steer: "congestion" },
  "rival: true-value bid only":   { bid: "truevalue", steer: "shortest" },
  "rival (routing + true value)": { bid: "truevalue", steer: "congestion" },
};

/** Mean outcome for one subject policy, rotated through every boarding slot. */
export function evaluate(subject, { room = ROOM, scarcity = SCARCITY } = {}) {
  const acc = { delay: 0, won: 0, lost: 0, spent: 0, earned: 0, arrived: 0, roomDelay: 0, baseDelay: 0, auctions: 0 };
  for (let slot = 0; slot < room; slot++) {
    const fleet = [];
    for (let i = 0, k = 0; i < room; i++) {
      fleet.push(i === slot ? { name: "SUBJECT", ...subject }
                            : { name: `Opp${i}`, bid: OPPONENTS[k++ % OPPONENTS.length], steer: "shortest" });
    }
    const { summary, baseline } = playHeadless({ fleet, scarcity });
    const me = byName(summary).SUBJECT;
    acc.delay += me.delayTicks; acc.won += me.auctionsWon; acc.lost += me.auctionsLost;
    acc.spent += me.spent; acc.earned += me.earned; acc.arrived += me.arrived ? 1 : 0;
    acc.roomDelay += summary.scoreboard.totalDelay; acc.baseDelay += baseline.baselineDelay; acc.auctions += summary.auctions;
  }
  const n = room;
  return {
    delaySec: acc.delay / n / TICK_HZ, won: acc.won / n, lost: acc.lost / n,
    spent: acc.spent / n, earned: acc.earned / n, arrived: acc.arrived / n,
    auctionsPerRun: acc.auctions / n, roomRatio: acc.baseDelay ? acc.roomDelay / acc.baseDelay : null,
  };
}

const f1 = (x) => x.toFixed(1), f2 = (x) => x.toFixed(2), pct = (x) => `${Math.round(x * 100)}%`;

function table() {
  const rows = Object.entries(SUBJECTS).map(([name, subject]) => ({ name, ...evaluate(subject) }));
  const base = rows[0].delaySec;
  if (JSON_OUT) return console.log(JSON.stringify({ room: ROOM, scarcity: SCARCITY, rows }, null, 2));
  console.log(`\nMidnight Express -- bidding/routing policies vs a mixed room of ${ROOM} (scarcity ${SCARCITY}, ${f1(rows[0].auctionsPerRun)} auctions per run)\n`);
  console.log(`| Subject policy | Mean delay (s) | vs default | Auctions won / lost | Tokens spent / earned | Arrived |`);
  console.log(`|---|---:|---:|---:|---:|---:|`);
  for (const r of rows) {
    const vs = r.delaySec === base ? "—" : `${r.delaySec < base ? "−" : "+"}${Math.abs(Math.round((1 - r.delaySec / base) * 100))}%`;
    console.log(`| ${r.name} | ${f1(r.delaySec)} | ${vs} | ${f1(r.won)} / ${f1(r.lost)} | ${Math.round(r.spent)} / ${Math.round(r.earned)} | ${pct(r.arrived)} |`);
  }
  const ratios = rows.map((r) => r.roomRatio).filter(Boolean);
  console.log(`\nRoom / central dispatcher (total delay, same fleet): ${f2(Math.min(...ratios))}× – ${f2(Math.max(...ratios))}× across these rooms.\n`);
}

function sweep() {
  const values = [0.5, 1.0, 1.6, 1.9, 2.5, 3.0, 4.0, 6.0, 10.0];
  const rows = values.map((aggro) => ({ aggro, ...evaluate({ bid: "truevalue", steer: "congestion", aggro }) }));
  if (JSON_OUT) return console.log(JSON.stringify({ room: ROOM, scarcity: SCARCITY, rows }, null, 2));
  console.log(`\nAGENT_AGGRO sweep -- rival (routing + true value) vs a mixed room of ${ROOM} (scarcity ${SCARCITY})\n`);
  console.log(`| AGENT_AGGRO | Mean delay (s) | Auctions won / lost | Tokens spent / earned |`);
  console.log(`|---:|---:|---:|---:|`);
  for (const r of rows) console.log(`| ${r.aggro} | ${f1(r.delaySec)} | ${f1(r.won)} / ${f1(r.lost)} | ${Math.round(r.spent)} / ${Math.round(r.earned)} |`);
  const best = rows.reduce((a, b) => (b.delaySec < a.delaySec ? b : a));
  console.log(`\nLowest delay at AGENT_AGGRO=${best.aggro}. The shipped default is 3.0.\n`);
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("bench.js")) {
  const t0 = Date.now();
  SWEEP ? sweep() : table();
  if (!JSON_OUT) console.log(`(${Object.keys(SUBJECTS).length * ROOM} deterministic runs in ${((Date.now() - t0) / 1000).toFixed(1)}s)`);
}
