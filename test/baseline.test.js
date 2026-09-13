process.env.RUN_SECONDS = "120";
const { playHeadless, byName, BID_POLICIES, STEER_POLICIES } = await import("../server/headless.js");
const { centralizedBaseline } = await import("../server/baseline.js");

import { test } from "node:test";
import assert from "node:assert/strict";

const MIXED = ["timid", "casual", "keen", "sharp", "allin", "zero", "truevalue", "casual", "keen", "sharp"];
const fleet = MIXED.map((bid, i) => ({ name: `P${i}`, bid, steer: i === 6 ? "congestion" : "shortest" }));

test("a headless room of ten plays to the end and everyone gets home", () => {
  const { summary, baseline } = playHeadless({ fleet, scarcity: 3 });
  assert.equal(summary.scoreboard.arrivedCount, 10);
  assert.ok(summary.auctions >= 5, `contention happened (${summary.auctions} auctions)`);
  assert.equal(baseline.baselineArrived, 10);
  assert.ok(baseline.baselineDelay >= 0);
  assert.deepEqual(Object.keys(baseline.baselinePaths).sort(), summary.trains.map((t) => t.name).sort());
});

test("the centralized dispatcher never does worse than the self-interested room", () => {
  for (const scarcity of [2, 3, 5]) {
    const { summary, baseline } = playHeadless({ fleet, scarcity });
    assert.ok(baseline.baselineDelay <= summary.scoreboard.totalDelay,
      `scarcity ${scarcity}: central ${baseline.baselineDelay} vs room ${summary.scoreboard.totalDelay}`);
  }
});

test("the same fleet always produces the same run and the same baseline (determinism)", () => {
  const a = playHeadless({ fleet, scarcity: 3 });
  const b = playHeadless({ fleet, scarcity: 3 });
  assert.equal(a.summary.scoreboard.totalDelay, b.summary.scoreboard.totalDelay);
  assert.deepEqual(byName(a.summary).P6.path, byName(b.summary).P6.path);
  assert.equal(a.baseline.baselineDelay, b.baseline.baselineDelay);
  assert.deepEqual(a.baseline.baselinePaths, b.baseline.baselinePaths);
});

test("the baseline replays the identical fleet: same names, origins and destinations", () => {
  const { summary } = playHeadless({ fleet, scarcity: 3, baseline: false });
  const base = centralizedBaseline(summary, { scarcity: 3 });
  for (const t of summary.trains) {
    const p = base.baselinePaths[t.name];
    assert.equal(p[0], t.origin);
    assert.equal(p.at(-1), t.destination);
  }
});

test("unknown policies are rejected loudly", () => {
  assert.throws(() => playHeadless({ fleet: [{ bid: "yolo" }] }), /unknown bid policy/);
  assert.throws(() => playHeadless({ fleet: [{ steer: "teleport" }] }), /unknown steer policy/);
  assert.ok(Object.keys(BID_POLICIES).length >= 7);
  assert.ok(STEER_POLICIES.shortest && STEER_POLICIES.congestion);
});
