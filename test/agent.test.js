process.env.LLM_PROVIDER = "none";
const { parseSteerChoice, parseBidInBand, heuristicBid, heuristicSteer, AgentTrain } = await import("../server/agent.js");
const { Run } = await import("../server/sim.js");
const { resolveProvider } = await import("../server/llm.js");

import { test } from "node:test";
import assert from "node:assert/strict";

const VALID = ["NOR", "SOU", "OAK"];

test("parseSteerChoice takes the LAST valid code, so reasoning prose before it is fine", () => {
  assert.equal(parseSteerChoice("Oakland is occupied so NOR is slower... actually SOU. I choose OAK.", VALID), "OAK");
  assert.equal(parseSteerChoice("<think>NOR or OAK? OAK is busy.</think>\nNOR", VALID), "NOR");
  assert.equal(parseSteerChoice("oak", VALID), "OAK", "case-insensitive");
});

test("parseSteerChoice rejects empty cut-offs, prose, unknown codes and codes inside words", () => {
  assert.equal(parseSteerChoice("", VALID), null);
  assert.equal(parseSteerChoice(null, VALID), null);
  assert.equal(parseSteerChoice("I would take the northern route.", VALID), null);
  assert.equal(parseSteerChoice("XYZ", VALID), null);
  assert.equal(parseSteerChoice("BLOOMFIELD", ["BLO"]), null, "word boundary");
});

test("parseBidInBand accepts a number only inside [0.6x, 1.5x + 2] of the heuristic, capped at budget", () => {
  assert.equal(parseBidInBand("I will bid 25.", 20, 100), 25);
  assert.equal(parseBidInBand("Maybe 12, no, 18", 20, 100), 18, "last number wins");
  assert.equal(parseBidInBand("0", 20, 100), null, "the small-model failure mode: zero hands the track away");
  assert.equal(parseBidInBand("100", 20, 100), null, "above the band");
  assert.equal(parseBidInBand("32", 20, 100), 32, "top of band: ceil(30)+2");
  assert.equal(parseBidInBand("33", 20, 100), null);
  assert.equal(parseBidInBand("11", 20, 100), null, "below the band: floor(12)");
  assert.equal(parseBidInBand("45", 40, 30), null, "band is capped at the budget");
  assert.equal(parseBidInBand("", 20, 100), null);
  assert.equal(parseBidInBand("no number here", 20, 100), null);
});

function roomAt(node, destination) {
  const run = new Run({ minTraffic: 0, scarcity: 1 });
  const t = run.addTrain({ name: "Rival", isAgent: true });
  t.origin = node; t.node = node; t.destination = destination; t.path = [node];
  return { run, t };
}

test("heuristicSteer picks the shortest route when the track is clear and detours when it is occupied", () => {
  const { run, t } = roomAt("UNI", "BRA");
  assert.equal(heuristicSteer(run, t), "OAK", "UNI -> OAK -> BLO -> BRA is shortest");
  run.occupancy["OAK-UNI"] = "someone";
  assert.equal(heuristicSteer(run, t), "NOR", "detours north when the bridge is taken");
});

test("heuristicSteer never picks a non-adjacent node and never U-turns in transit", () => {
  const { run, t } = roomAt("UNI", "BRA");
  run.phase = "running"; run.step();
  assert.equal(t.state, "on_segment"); assert.equal(t.to, "OAK");
  const pick = heuristicSteer(run, t);
  assert.notEqual(pick, "UNI", "no U-turn");
  assert.ok(["STR", "HAZ", "BLO", "SHA"].includes(pick), `adjacent to OAK: ${pick}`);
});

test("heuristicBid is a true-value bid: bounded by budget, growing with the wait avoided and with urgency", () => {
  const { run, t } = roomAt("UNI", "BRA");
  run.phase = "running";
  const auction = { segmentId: "OAK-UNI" };
  const bid = heuristicBid(run, t, auction);
  assert.ok(Number.isInteger(bid) && bid >= 0 && bid <= t.budget, `bid ${bid} within budget`);
  t.budget = 10;
  assert.ok(heuristicBid(run, t, auction) <= 10, "never exceeds a small budget");
  t.budget = 100;
  const late = roomAt("BLO", "BRA");   // one hop from home: losing costs nearly the whole remaining journey
  late.run.phase = "running";
  const lateBid = heuristicBid(late.run, late.t, { segmentId: "BLO-BRA" });
  assert.ok(lateBid > bid, `more urgent near the destination (${lateBid} > ${bid})`);
  assert.equal(heuristicBid(run, t, { segmentId: "nope" }), 0);
  assert.ok(heuristicBid(run, t, auction, 0.5) < heuristicBid(run, t, auction, 3.0), "aggression scales the bid");
});

test("with no model configured the AgentTrain is the heuristic and says so", async () => {
  const p = await resolveProvider();
  assert.equal(p.provider, "none");
  const { run, t } = roomAt("UNI", "BRA");
  const agent = new AgentTrain({ run, trainId: t.id });
  assert.equal(agent.usingLLM, false);
  assert.equal(await agent.decideSteer(), "OAK");
  run.phase = "running";
  assert.equal(await agent.decideBid({ segmentId: "OAK-UNI" }), heuristicBid(run, t, { segmentId: "OAK-UNI" }));
  const s = agent.stats();
  assert.equal(s.calls, 0, "no model call was even attempted");
  assert.equal(s.last, "heuristic");
});
