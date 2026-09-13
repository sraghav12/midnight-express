process.env.DISPATCHER_MODE = "rules";
process.env.DISPATCH_MIN_GAP_MS = "30";
process.env.LLM_PROVIDER = "none";
const { Dispatcher } = await import("../server/dispatcher.js");
const { Run } = await import("../server/sim.js");

import { test } from "node:test";
import assert from "node:assert/strict";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function room() {
  const run = new Run({ minTraffic: 0 });
  const a = run.addTrain({ name: "Priya" });
  const b = run.addTrain({ name: "Marcus" });
  const f = run.addTrain({ name: "Freight 1", isAgent: true });
  const said = [];
  const d = new Dispatcher({ run, say: (text, meta) => said.push({ text, meta }) });
  return { run, a, b, f, said, d };
}

test("departure and auction-open lines are urgent: verbatim, with every name and number", () => {
  const { run, a, b, said, d } = room();
  d.onDeparture(run.trains.size);
  d.onAuction({ auctionId: "a1", segment: "OAK-UNI", bidders: [{ trainId: a.id, name: a.name }, { trainId: b.id, name: b.name }] });
  assert.equal(said.length, 2);
  assert.match(said[0].text, /^The Midnight Express is away\. 3 trains/);
  assert.match(said[1].text, /Track contested at Oakland\. Priya against Marcus\. \d+ seconds\./);
  d.onAuction({ auctionId: "a1", segment: "OAK-UNI", bidders: [] });
  assert.equal(said.length, 2, "an auction is announced once");
  d.onDeparture(9);
  assert.equal(said.length, 2, "departure is announced once");
});

test("colour lines respect the minimum gap; urgent lines do not", async () => {
  const { run, a, b, said, d } = room();
  d.onDeparture(3);                                             // urgent, sets the clock
  d.onSettled({ winner: a.id, pricePaid: 16, compensation: { [b.id]: 16 } }, run);
  assert.equal(said.length, 1, "suppressed inside the gap");
  await sleep(40);
  d.onSettled({ winner: a.id, pricePaid: 16, compensation: { [b.id]: 16 } }, run);
  assert.equal(said.length, 2);
  assert.equal(said[1].text, "Priya takes it for 16. Marcus held and compensated.");
  d.onArrived(a);                                               // inside the gap again
  assert.equal(said.length, 2);
});

test("freight arrivals are not news; human arrivals are, once", async () => {
  const { a, f, said, d } = room();
  d.onArrived(f);
  assert.equal(said.length, 0);
  d.onArrived(a);
  assert.equal(said.length, 1);
  assert.equal(said[0].text, "Priya is home at Homestead.");
  await sleep(40);
  d.onArrived(a);
  assert.equal(said.length, 1);
});

test("the verdict states the ratio against the central dispatcher, or the rare draw", () => {
  const { said, d } = room();
  d.onRunEnd({ scoreboard: { totalDelay: 500, totalCount: 3 }, baselineDelay: 200, trains: [] });
  assert.equal(said.at(-1).text, "All in. One dispatcher would have done that with 2.5 times less delay. You were all being selfish.");
  d.onRunEnd({ scoreboard: { totalDelay: 210, totalCount: 3 }, baselineDelay: 200, trains: [] });
  assert.equal(said.at(-1).text, "All in. You matched a central dispatcher. That almost never happens.");
  d.onRunEnd({ scoreboard: { totalDelay: 0, totalCount: 3 }, trains: [] });
  assert.equal(said.at(-1).text, "All trains in.");
  assert.ok(said.every((s) => s.meta?.kind !== "recap"), "no model, so no recap line");
});

test("the periodic tick only speaks when humans are actually stuck", () => {
  const { run, a, b, said, d } = room();
  run.phase = "running";
  d.tick();
  assert.equal(said.length, 0);
  a.state = "waiting"; b.state = "waiting";
  d.tick();
  assert.equal(said.at(-1).text, "2 trains held at signals. Somebody is going to have to pay.");
});

test("stats report the mode", () => {
  const { d } = room();
  assert.deepEqual(d.stats(), { enabled: true, mode: "rules", usingLLM: false, lines: 0 });
});
