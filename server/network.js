// The rail network. Deliberately under-provisioned: every segment holds ONE train,
// and the west-to-east traffic has to squeeze through three bridges, of which
// UNI-OAK is the real chokepoint. Contention is a design goal, not a bug.

export const NODES = {
  NOR: { name: "Northside",     x: 150, y: 150 },
  UNI: { name: "Union",         x: 150, y: 300 },
  SOU: { name: "Southside",     x: 150, y: 450 },

  STR: { name: "Strip",         x: 400, y: 150 },
  OAK: { name: "Oakland",       x: 400, y: 300 },
  HAZ: { name: "Hazelwood",     x: 400, y: 450 },

  LAW: { name: "Lawrenceville", x: 650, y: 120 },
  BLO: { name: "Bloomfield",    x: 650, y: 250 },
  SHA: { name: "Shadyside",     x: 650, y: 360 },
  SQH: { name: "Squirrel Hill", x: 650, y: 480 },

  BRA: { name: "Braddock",      x: 880, y: 200 },
  HOM: { name: "Homestead",     x: 880, y: 420 },
};

// [a, b] -- undirected, capacity 1.
const EDGES = [
  ["NOR", "UNI"], ["UNI", "SOU"],
  ["NOR", "STR"], ["UNI", "OAK"], ["SOU", "HAZ"],   // the three bridges
  ["STR", "OAK"], ["OAK", "HAZ"],
  ["STR", "LAW"], ["STR", "BLO"],
  ["OAK", "BLO"], ["OAK", "SHA"],
  ["HAZ", "SQH"],
  ["LAW", "BRA"], ["BLO", "BRA"],
  ["SHA", "BRA"], ["SHA", "HOM"], ["SQH", "HOM"],
];

export const segId = (a, b) => (a < b ? `${a}-${b}` : `${b}-${a}`);

function build() {
  const segments = {};
  const adjacency = {};
  for (const k of Object.keys(NODES)) adjacency[k] = [];

  for (const [a, b] of EDGES) {
    const id = segId(a, b);
    const dx = NODES[a].x - NODES[b].x;
    const dy = NODES[a].y - NODES[b].y;
    // length in ticks-to-traverse at full throttle
    const length = Math.round(Math.hypot(dx, dy) / 10);
    segments[id] = { id, a, b, length };
    adjacency[a].push({ to: b, seg: id, length });
    adjacency[b].push({ to: a, seg: id, length });
  }
  return { segments, adjacency };
}

export const { segments: SEGMENTS, adjacency: ADJ } = build();

// Spawn west, deliver east. Guarantees the bridges are the contested resource.
export const ORIGINS = ["NOR", "UNI", "SOU"];
export const DESTINATIONS = ["BRA", "HOM", "LAW", "SQH"];

/** Dijkstra on segment length. Ignores occupancy -- used for hints and for the
 *  centralized baseline's shortest-path prior. Returns [nodeIds] or null. */
export function shortestPath(from, to) {
  const dist = { [from]: 0 };
  const prev = {};
  const seen = new Set();
  const queue = new Set(Object.keys(NODES));

  while (queue.size) {
    let u = null;
    for (const n of queue) {
      if (dist[n] === undefined) continue;
      if (u === null || dist[n] < dist[u]) u = n;
    }
    if (u === null) break;
    queue.delete(u);
    seen.add(u);
    if (u === to) break;

    for (const { to: v, length } of ADJ[u]) {
      if (seen.has(v)) continue;
      const alt = dist[u] + length;
      if (dist[v] === undefined || alt < dist[v]) {
        dist[v] = alt;
        prev[v] = u;
      }
    }
  }

  if (dist[to] === undefined) return null;
  const path = [to];
  let cur = to;
  while (cur !== from) {
    cur = prev[cur];
    path.unshift(cur);
  }
  return path;
}

/** Serialisable network for the clients (Lane B draws from this). */
export function networkPayload() {
  return {
    nodes: NODES,
    segments: Object.values(SEGMENTS).map(({ id, a, b, length }) => ({ id, a, b, length })),
  };
}
