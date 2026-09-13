// The sim reads pacing from the environment at import, so pin it before importing:
// 1-second auctions and a 30-second run cap keep every test here well under a second.
process.env.AUCTION_SECONDS = "1";
process.env.RUN_SECONDS = "30";
const { Run, AUCTION_TICKS, RUN_TICKS, START_BUDGET } = await import("../server/sim.js");
const { shortestPath, ORIGINS } = await import("../server/network.js");

import { test } from "node:test";
import assert from "node:assert/strict";

/** Occupancy must always mirror where the trains are. Ghost occupancy = deadlock. */
function assertOccupancyConsistent(run) {
  for (const [sid, tid] of Object.entries(run.occupancy)) {
    if (!tid) continue;
    const t = run.trains.get(tid);
    assert.ok(t && t.state === "on_segment" && t.seg === sid, `ghost occupancy on ${sid} by ${tid} (train state ${t?.state}, seg ${t?.seg})`);
  }
  for (const t of run.trains.values()) if (t.state === "on_segment") assert.equal(run.occupancy[t.seg], t.id);
}

function stepUntilEnded(run, guard = 20000) {
  while (run.phase === "running" && guard-- > 0) { run.step(); assertOccupancyConsistent(run); }
  assert.equal(run.phase, "ended", "run ended");
}

/** n trains standing at `node`, all wanting to go to `next`. Contention on demand. */
function contested(n, { node = "UNI", next = "OAK", destination = "BRA", scarcity = 1 } = {}) {
  const events = [];
  const run = new Run({ minTraffic: 0, scarcity, onEvent: (e) => events.push(e) });
  const trains = Array.from({ length: n }, (_, i) => run.addTrain({ name: `T${i + 1}` }));
  for (const t of trains) { t.origin = node; t.node = node; t.destination = destination; t.path = [node]; run.setSteer(t.id, next); }
  run.phase = "running";
  return { run, trains, events };
}

test("pacing constants come from the environment", () => {
  assert.equal(AUCTION_TICKS, 20);
  assert.equal(RUN_TICKS, 600);
  assert.equal(START_BUDGET, 100);
});

test("boarding cycles the western origins and never sends a train where it already is", () => {
  const run = new Run({ minTraffic: 0 });
  for (let i = 0; i < 9; i++) {
    const t = run.addTrain({ name: `P${i}` });
    assert.equal(t.origin, ORIGINS[i % ORIGINS.length]);
    assert.notEqual(t.origin, t.destination);
    assert.ok(shortestPath(t.origin, t.destination));
    assert.equal(t.budget, START_BUDGET);
  }
  assert.equal(run.addTrain({}).name, "Train 10");
});

test("start() tops the room up to minTraffic with agent freight", () => {
  const run = new Run({ minTraffic: 6 });
  run.addTrain({ name: "Human" });
  run.start();
  assert.equal(run.phase, "running");
  assert.equal(run.trains.size, 6);
  const agents = [...run.trains.values()].filter((t) => t.isAgent);
  assert.equal(agents.length, 5);
  assert.ok(agents.every((t) => /^Freight \d$/.test(t.name)));
});

test("a lone train auto-routes along the shortest path and arrives with zero delay", () => {
  const run = new Run({ minTraffic: 0, scarcity: 1 });
  const t = run.addTrain({ name: "Solo" });
  run.start();
  stepUntilEnded(run);
  assert.equal(t.state, "arrived");
  assert.deepEqual(t.path, shortestPath(t.origin, t.destination));
  assert.equal(Math.round(t.delayTicks), 0);
  assert.equal(run.summary().scoreboard.arrivedCount, 1);
});

test("steer accepts only adjacent nodes and a pre-selection survives arrival at the junction", () => {
  const run = new Run({ minTraffic: 0, scarcity: 1 });
  const t = run.addTrain({ name: "Pilot" });
  t.node = "UNI"; t.origin = "UNI"; t.destination = "BRA"; t.path = ["UNI"];
  assert.equal(run.setSteer(t.id, "BRA"), false, "not adjacent");
  assert.equal(run.setSteer(t.id, "NOR"), true);
  run.phase = "running";
  run.step();
  assert.equal(t.state, "on_segment"); assert.equal(t.to, "NOR");
  // in transit, the junction ahead is NOR: pre-select STR for it
  assert.equal(run.junctionNode(t), "NOR");
  assert.equal(run.setSteer(t.id, "OAK"), false, "OAK is not adjacent to the junction ahead");
  assert.equal(run.setSteer(t.id, "STR"), true);
  while (t.node !== "NOR") run.step();
  assert.equal(t.steer, "STR", "pre-selection kept at the junction");
  run.step();
  assert.equal(t.to, "STR");
});

test("throttle is clamped and a stopped train accrues delay until the run cap ends it", () => {
  const run = new Run({ minTraffic: 0 });
  const t = run.addTrain({ name: "Stuck" });
  run.setThrottle(t.id, 5); assert.equal(t.throttle, 1);
  run.setThrottle(t.id, -1); assert.equal(t.throttle, 0);
  run.start();
  stepUntilEnded(run);
  assert.equal(run.tick, RUN_TICKS);
  assert.equal(t.state, "on_segment", "entered its first segment but never moved");
  assert.ok(t.delayTicks > 0);
  assert.equal(run.summary().scoreboard.arrivedCount, 0);
});

test("two trains wanting one free segment open a sealed auction and both are held", () => {
  const { run, trains: [a, b], events } = contested(2);
  run.step();
  assert.equal(run.auctions.size, 1);
  assert.equal(a.state, "waiting"); assert.equal(b.state, "waiting");
  const ev = events.find((e) => e.t === "auction");
  assert.ok(ev);
  assert.equal(ev.auction.segment, "OAK-UNI");
  assert.match(ev.auction.segmentName, /Oakland/);
  assert.deepEqual(ev.auction.bidders.map((x) => x.trainId).sort(), [a.id, b.id].sort());
  assert.equal(ev.auction.msRemaining, 1000);
  assert.equal(run.occupancy["OAK-UNI"], null, "nobody enters until it settles");
});

test("second price: the winner pays the second-highest bid and losers split it", () => {
  const { run, trains: [a, b, c], events } = contested(3);
  run.step();
  const [auction] = run.auctions.values();
  assert.equal(run.placeBid(a.id, auction.id, 30), true);
  assert.equal(run.placeBid(b.id, auction.id, 16), true);
  assert.equal(run.placeBid(c.id, auction.id, 4), true);
  for (let i = 0; i < AUCTION_TICKS; i++) run.step();
  const s = events.find((e) => e.t === "settled").settlement;
  assert.equal(s.winner, a.id);
  assert.equal(s.winningBid, 30);
  assert.equal(s.pricePaid, 16);
  assert.deepEqual(s.compensation, { [b.id]: 8, [c.id]: 8 });
  assert.equal(a.budget, 84); assert.equal(a.spent, 16); assert.equal(a.auctionsWon, 1);
  assert.equal(b.budget, 108); assert.equal(b.earned, 8); assert.equal(b.auctionsLost, 1);
  assert.equal(c.budget, 108);
  assert.equal(a.state, "on_segment"); assert.equal(a.seg, "OAK-UNI");
  assert.equal(b.state, "at_node"); assert.equal(c.state, "at_node");
  assertOccupancyConsistent(run);
});

test("a two-way auction: bid 30 vs 16 pays 16, the loser is compensated the full 16", () => {
  const { run, trains: [a, b], events } = contested(2);
  run.step();
  const [auction] = run.auctions.values();
  run.placeBid(a.id, auction.id, 30); run.placeBid(b.id, auction.id, 16);
  for (let i = 0; i < AUCTION_TICKS; i++) run.step();
  const s = events.find((e) => e.t === "settled").settlement;
  assert.equal(s.pricePaid, 16);
  assert.deepEqual(s.compensation, { [b.id]: 16 });
});

test("ties break toward the train with more accumulated delay", () => {
  const { run, trains: [a, b], events } = contested(2);
  run.step();
  const [auction] = run.auctions.values();
  run.placeBid(a.id, auction.id, 10); run.placeBid(b.id, auction.id, 10);
  b.delayTicks += 50;
  for (let i = 0; i < AUCTION_TICKS; i++) run.step();
  const s = events.find((e) => e.t === "settled").settlement;
  assert.equal(s.winner, b.id);
  assert.equal(s.pricePaid, 10);
});

test("bids are integers clamped to [0, budget]; only bidders may bid; closed auctions refuse", () => {
  const { run, trains: [a, b] } = contested(2);
  const outsider = run.addTrain({ name: "Outsider" });
  run.step();
  const [auction] = run.auctions.values();
  run.placeBid(a.id, auction.id, 999);  assert.equal(auction.bids.get(a.id), 100);
  run.placeBid(a.id, auction.id, -5);   assert.equal(auction.bids.get(a.id), 0);
  run.placeBid(a.id, auction.id, 12.7); assert.equal(auction.bids.get(a.id), 12);
  run.placeBid(a.id, auction.id, "abc"); assert.equal(auction.bids.get(a.id), 0);
  assert.equal(run.placeBid(outsider.id, auction.id, 5), false);
  assert.equal(run.placeBid(b.id, "nope", 5), false);
  for (let i = 0; i < AUCTION_TICKS; i++) run.step();
  assert.equal(run.placeBid(a.id, auction.id, 5), false, "closed");
});

test("regression: a bidder that steers away mid-auction stays held, then follows its new choice", () => {
  // Before the fix, A claimed NOR-UNI while still a bidder; settlement then overwrote
  // its segment and NOR-UNI stayed occupied by a ghost, stranding A for the whole run.
  const { run, trains: [a, b], events } = contested(2);
  run.step();
  assert.equal(run.setSteer(a.id, "NOR"), true, "steering while held is allowed");
  run.step();
  assert.equal(a.state, "waiting", "but it does not leave the auction");
  assert.equal(run.occupancy["NOR-UNI"], null);
  const [auction] = run.auctions.values();
  run.placeBid(a.id, auction.id, 1); run.placeBid(b.id, auction.id, 5);
  for (let i = 0; i < AUCTION_TICKS; i++) run.step();
  assert.equal(events.find((e) => e.t === "settled").settlement.winner, b.id);
  assertOccupancyConsistent(run);
  run.step();
  assert.equal(a.state, "on_segment"); assert.equal(a.to, "NOR", "the steer made during the auction is honoured after it");
  stepUntilEnded(run);
  assert.equal(a.state, "arrived"); assert.equal(b.state, "arrived");
  assert.deepEqual(Object.values(run.occupancy).filter(Boolean), [], "no ghost occupancy at the end");
});

test("held bidders accrue one tick of delay per tick of the auction", () => {
  const { run, trains: [a] } = contested(2);
  run.step();
  const before = a.delayTicks;
  for (let i = 0; i < 5; i++) run.step();
  assert.equal(a.delayTicks - before, 5);
});

test("a train arriving at a contested segment while an auction is open waits without joining it", () => {
  const { run, trains: [a, b] } = contested(2);
  run.step();
  const late = run.addTrain({ name: "Late" });
  late.node = "UNI"; late.origin = "UNI"; late.destination = "BRA"; late.path = ["UNI"]; run.setSteer(late.id, "OAK");
  run.step();
  const [auction] = run.auctions.values();
  assert.equal(auction.bidders.length, 2);
  assert.equal(late.state, "at_node");
  assert.ok(late.delayTicks >= 1);
  assertOccupancyConsistent(run);
});

test("the centralized policy resolves contention instantly, with no auction", () => {
  const { run, trains: [a, b] } = contested(2);
  run.policy = "central";
  a.delayTicks = 3;
  run.step();
  assert.equal(run.auctions.size, 0);
  assert.equal(a.state, "on_segment", "most delayed goes first");
  assert.equal(b.state, "at_node");
  assert.equal(b.delayTicks, 1);
  assertOccupancyConsistent(run);
});

test("a run ends when every train is home, with a like-for-like scoreboard", () => {
  const { run, trains } = contested(3, { scarcity: 1 });
  stepUntilEnded(run);
  assert.ok(trains.every((t) => t.state === "arrived"));
  const s = run.summary();
  assert.equal(s.scoreboard.arrivedCount, 3);
  assert.equal(s.scoreboard.totalCount, 3);
  assert.equal(s.scoreboard.totalDelay, trains.reduce((n, t) => n + Math.round(t.delayTicks), 0));
  assert.equal(s.scoreboard.humanSwarmDelay, s.scoreboard.totalDelay, "no agents in this room");
  assert.equal(s.scoreboard.agentDelay, 0);
  assert.ok(s.auctions >= 1, "the contested start produced at least one settled auction");
  assert.equal(s.log.length, Math.floor(run.tick / 10), "telemetry every 10 ticks");
  JSON.stringify(s); JSON.stringify(run.stateView());
});

test("end() fires runEnd exactly once and hands the summary to the chain adapter", () => {
  const calls = [];
  const chain = { finalizeRun: (runId, summary) => calls.push([runId, summary.ticks]) };
  const run = new Run({ minTraffic: 0, chain, onEvent: (e) => { if (e.t === "runEnd") calls.push("event"); } });
  run.addTrain({ name: "Only" });
  run.start(); stepUntilEnded(run);
  run.end(); run.end();
  assert.equal(calls.filter((c) => c === "event").length, 1);
  assert.equal(calls.filter((c) => Array.isArray(c)).length, 1);
  assert.equal(calls.find(Array.isArray)[0], run.runId);
});
