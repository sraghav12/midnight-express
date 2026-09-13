/**
 * Headless play: run the simulation to completion with no server, no sockets and
 * no clock, every train driven by a policy. Used by the tests and by
 * scripts/bench.js. Fully deterministic -- the sim has no randomness, so the same
 * fleet always produces the same run.
 *
 *   playHeadless({ fleet: [{ name, bid: "allin", steer: "shortest" }, ...] })
 *     -> { summary, baseline }   (summary as the server would broadcast it, plus
 *                                 the centralized baseline for the same fleet)
 */
import { Run } from "./sim.js";
import { heuristicSteer, heuristicBid } from "./agent.js";
import { centralizedBaseline } from "./baseline.js";

/** Bidding policies. Each maps (run, train, auction) -> integer bid. */
export const BID_POLICIES = {
  zero:      () => 0,                                       // never touches the phone
  timid:     (run, t) => Math.round(t.budget * 0.05),
  casual:    (run, t) => Math.round(t.budget * 0.15),
  keen:      (run, t) => Math.round(t.budget * 0.30),
  sharp:     (run, t) => Math.round(t.budget * 0.50),
  allin:     (run, t) => t.budget,
  truevalue: (run, t, a) => heuristicBid(run, t, a),        // the rival's calibrated rule
};

/** Routing policies. Each maps (run, train) -> next node, or null for the sim's default (shortest path). */
export const STEER_POLICIES = {
  shortest:   () => null,                                   // auto-route, like an idle player
  congestion: (run, t) => heuristicSteer(run, t),           // the rival's congestion-aware routing
};

const STEER_EVERY = 12;   // ticks between re-routing decisions, same cadence as the server

/**
 * @param {object} opts
 * @param {Array<{name?:string, bid?:string|Function, steer?:string|Function, aggro?:number}>} opts.fleet
 * @param {number} [opts.scarcity]
 * @param {number} [opts.minTraffic=0]  extra freight (policy: zero / shortest)
 * @param {boolean} [opts.baseline=true] also replay under the centralized dispatcher
 */
export function playHeadless({ fleet, scarcity, minTraffic = 0, baseline = true } = {}) {
  const policies = new Map();   // trainId -> { bid, steer }
  const run = new Run({ scarcity, minTraffic, onEvent });

  function resolve(kind, p, table) {
    if (typeof p === "function") return p;
    if (p == null) return table[kind === "bid" ? "zero" : "shortest"];
    if (!table[p]) throw new Error(`unknown ${kind} policy "${p}"`);
    return table[p];
  }

  for (const f of fleet) {
    const t = run.addTrain({ name: f.name, isAgent: true });
    const bid = resolve("bid", f.bid, BID_POLICIES);
    policies.set(t.id, {
      bid: f.aggro != null && f.bid === "truevalue" ? (r, tr, a) => heuristicBid(r, tr, a, f.aggro) : bid,
      steer: resolve("steer", f.steer, STEER_POLICIES),
    });
  }

  function onEvent(ev) {
    if (ev.t !== "auction") return;
    const live = run.auctions.get(ev.auction.auctionId);
    for (const b of ev.auction.bidders) {
      const t = run.trains.get(b.trainId);
      const p = policies.get(b.trainId) || { bid: BID_POLICIES.zero };
      run.placeBid(b.trainId, live.id, p.bid(run, t, live));
    }
  }

  run.start();   // filler freight (if any) is added here and keeps the sim's defaults
  let guard = 0;
  while (run.phase === "running" && guard++ < 100000) {
    if (run.tick % STEER_EVERY === 0) {
      for (const [id, p] of policies) {
        const t = run.trains.get(id);
        if (!t || t.state === "arrived") continue;
        const to = p.steer(run, t);
        if (to) run.setSteer(id, to);
      }
    }
    run.step();
  }

  const summary = run.summary();
  const base = baseline ? centralizedBaseline(summary, { scarcity: run.scarcity }) : null;
  return { summary, baseline: base, run };
}

/** Per-train result lookup by name. */
export function byName(summary) {
  return Object.fromEntries(summary.trains.map((t) => [t.name, t]));
}
