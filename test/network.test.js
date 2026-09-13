import { test } from "node:test";
import assert from "node:assert/strict";
import { NODES, SEGMENTS, ADJ, segId, shortestPath, ORIGINS, DESTINATIONS, networkPayload } from "../server/network.js";

test("segment ids are direction-independent", () => {
  assert.equal(segId("UNI", "OAK"), segId("OAK", "UNI"));
  assert.equal(segId("UNI", "OAK"), "OAK-UNI");
});

test("the network is the documented shape: 12 stations, 17 single-track segments", () => {
  assert.equal(Object.keys(NODES).length, 12);
  assert.equal(Object.keys(SEGMENTS).length, 17);
  for (const s of Object.values(SEGMENTS)) {
    assert.ok(s.length >= 1, `${s.id} has a positive length`);
    assert.ok(NODES[s.a] && NODES[s.b], `${s.id} joins two real stations`);
  }
});

test("Oakland is the degree-5 chokepoint", () => {
  assert.equal(ADJ.OAK.length, 5);
  assert.equal(Math.max(...Object.values(ADJ).map((a) => a.length)), 5);
});

test("every origin can reach every destination along real segments", () => {
  for (const o of ORIGINS) for (const d of DESTINATIONS) {
    const p = shortestPath(o, d);
    assert.ok(p, `${o} -> ${d}`);
    assert.equal(p[0], o);
    assert.equal(p.at(-1), d);
    for (let i = 0; i < p.length - 1; i++) assert.ok(SEGMENTS[segId(p[i], p[i + 1])], `edge ${p[i]}-${p[i + 1]} exists`);
  }
});

test("Dijkstra agrees with brute force on every origin/destination pair", () => {
  function allPaths(from, to, seen = new Set([from])) {
    if (from === to) return [[to]];
    const out = [];
    for (const { to: v } of ADJ[from]) {
      if (seen.has(v)) continue;
      for (const rest of allPaths(v, to, new Set([...seen, v]))) out.push([from, ...rest]);
    }
    return out;
  }
  const cost = (p) => p.slice(1).reduce((c, n, i) => c + SEGMENTS[segId(p[i], n)].length, 0);
  for (const o of ORIGINS) for (const d of DESTINATIONS) {
    const best = Math.min(...allPaths(o, d).map(cost));
    assert.equal(cost(shortestPath(o, d)), best, `${o} -> ${d}`);
  }
});

test("shortestPath handles the trivial and the impossible", () => {
  assert.deepEqual(shortestPath("OAK", "OAK"), ["OAK"]);
  assert.equal(shortestPath("OAK", "ZZZ"), null);
});

test("the client payload is serialisable and self-consistent", () => {
  const p = JSON.parse(JSON.stringify(networkPayload()));
  assert.equal(p.segments.length, 17);
  for (const s of p.segments) assert.ok(p.nodes[s.a] && p.nodes[s.b]);
});
