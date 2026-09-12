/**
 * LANE C — the rival train.
 *
 * Design rule: this must be a GOOD player with no API key at all, and a
 * distinctly better one with a Grok key. A demo that depends on a key working
 * at 4pm is a demo that can fail at 4pm.
 *
 *   no key  -> congestion-aware heuristic (routes around busy track, bids its
 *              true value like a rational Vickrey bidder)
 *   key     -> grok-4.6 tool-calling picks the route and the bid, with the
 *              heuristic as the fallback on any error or timeout
 *
 * Either way it plays through exactly the same two actions a phone has:
 * setSteer and placeBid. It is a player, not a narrator.
 */
import { ADJ, SEGMENTS, NODES, shortestPath, segId } from "./network.js";
import { complete, providerSync } from "./llm.js";

const TIMEOUT_MS = Number(process.env.AGENT_TIMEOUT_MS || 2500);
const STEER_TOKENS = Number(process.env.AGENT_STEER_TOKENS || 700);

/** Cost of a route in ticks, penalising segments that are currently occupied. */
function routeCost(run, from, to) {
  const path = shortestPath(from, to);
  if (!path) return Infinity;
  let cost = 0;
  for (let i = 0; i < path.length - 1; i++) {
    const sid = segId(path[i], path[i + 1]);
    cost += SEGMENTS[sid].length * run.scarcity;
    if (run.occupancy[sid]) cost += 40;           // someone is in the way
  }
  return cost;
}

/** Pick the neighbour that minimises congestion-aware cost to the destination. */
export function heuristicSteer(run, train) {
  const junction = run.junctionNode(train);
  let best = null;
  for (const { to } of ADJ[junction]) {
    if (to === train.from && train.state === "on_segment") continue;   // no U-turn
    const sid = segId(junction, to);
    const hop = SEGMENTS[sid].length * run.scarcity + (run.occupancy[sid] ? 45 : 0);
    const rest = routeCost(run, to, train.destination);
    const total = hop + rest;
    if (!best || total < best.total) best = { to, total };
  }
  return best?.to ?? null;
}

/**
 * True value of winning this segment, in tokens.
 *
 * A rational Vickrey bidder bids its TRUE VALUE, because it pays the other bid.
 * The value here is the wait it avoids: a train that loses this auction does not
 * take a detour, it sits at the signal until the winner clears the segment. So
 * the thing being bought is `waitTicks`, measured against the journey still to go.
 *
 * (An earlier version priced the detour delta instead and bid ~8 against
 * opponents bidding 0-40, losing almost every auction. AGENT_AGGRO below was
 * calibrated by sweep, not by taste.)
 */
// Calibrated 2026-09-12 by sweep against five opponent models (timid/casual/keen/
// sharp/all-in). 3.0 is the ONLY value that beats the default train against every
// one of them; 1.6 and 1.9 lose outright to aggressive bidders (-16%, -8%).
// It is not a constant all-in: urgency scales with how much journey is left.
const AGGRO = Number(process.env.AGENT_AGGRO || 3.0);

export function heuristicBid(run, train, auction) {
  const junction = run.junctionNode(train);
  const seg = SEGMENTS[auction.segmentId];
  if (!seg) return 0;

  // what losing costs: the winner has to clear the whole segment first
  const waitTicks = seg.length * run.scarcity;

  // what is still ahead of us, so an early junction is not over-valued
  const remaining = routeCost(run, junction, train.destination) || waitTicks;

  const urgency = waitTicks / (waitTicks + remaining);
  const bid = train.budget * urgency * AGGRO;
  return Math.max(0, Math.min(train.budget, Math.round(bid)));
}

// ---------------------------------------------------------------------------

export class AgentTrain {
  constructor({ run, trainId } = {}) {
    this.run = run;
    this.trainId = trainId;
    this.calls = 0;
    this.llmWins = 0;
    this.llmFails = 0;
    this.lastReason = "heuristic";
    this.lastSteer = null;
    this.lastJunction = null;   // index.js: ask the model once per junction
    this.busy = false;          // index.js: never overlap reasoning calls
  }

  get train() { return this.run.trains.get(this.trainId); }
  get usingLLM() { return providerSync().provider !== "none"; }
  get providerLabel() { return providerSync().label; }

  /** Compact board state. Keep it small — this goes out on every decision. */
  snapshot() {
    const t = this.train;
    const junction = this.run.junctionNode(t);
    return {
      you: { at: junction, destination: t.destination, budget: t.budget, delay: Math.round(t.delayTicks) },
      options: ADJ[junction].map(({ to }) => {
        const sid = segId(junction, to);
        return {
          node: to, name: NODES[to].name,
          travelTicks: Math.round(SEGMENTS[sid].length * this.run.scarcity),
          occupied: Boolean(this.run.occupancy[sid]),
          ticksToDestinationAfter: Math.round(routeCost(this.run, to, t.destination)),
        };
      }),
    };
  }

  /**
   * Route choice is the model's job. Asked ONCE per junction (index.js gates it),
   * with reasoning ON: thinking off, the 0.9B model echoes the prompt back; with
   * it on, it reads the options and picks the shorter unoccupied track. ~2s.
   */
  async decideSteer() {
    const fallback = heuristicSteer(this.run, this.train);
    if (!this.usingLLM) return fallback;
    try {
      const snap = this.snapshot();
      const valid = snap.options.map((o) => o.node);
      const prompt =
        `Trains race to ${NODES[snap.you.destination].name}. From ${NODES[snap.you.at].name} you can go to:\n` +
        snap.options.map((o) => `${o.node} = ${o.name}: ${o.ticksToDestinationAfter} ticks to destination${o.occupied ? ", track OCCUPIED" : ""}`).join("\n") +
        `\nWhich code do you choose? End your answer with the 3-letter code.`;
      // Reasoning length grows with the number of options: a 2-way junction fits
      // in ~220 tokens, Oakland (5-way) does not -- and a length cutoff returns
      // EMPTY content, which read as "invalid" in the first live run.
      const out = await this.#ask(prompt, { maxTokens: STEER_TOKENS, timeoutMs: 9000, thinking: true });
      this.lastRaw = String(out).slice(0, 80);
      const codes = [...String(out).toUpperCase().matchAll(/\b([A-Z]{3})\b/g)].map((m) => m[1]).filter((c) => valid.includes(c));
      const pick = codes.at(-1);
      if (pick) { this.llmWins++; this.lastReason = providerSync().provider; this.lastSteer = pick; return pick; }
      this.llmFails++; this.lastReason = "invalid";
    } catch { this.llmFails++; this.lastReason = "error"; }
    return fallback;
  }

  /**
   * Bids use the calibrated true-value rule. The model is consulted only when
   * LLM_BIDS=1: an open-ended number needs ~400 reasoning tokens (~3s), and its
   * answer is accepted only within a band of the heuristic -- it may move the bid,
   * it cannot abandon it (a 0.9B model asked for "an integer" will say 0).
   */
  async decideBid(auction) {
    const fallback = heuristicBid(this.run, this.train, auction);
    if (!this.usingLLM || process.env.LLM_BIDS !== "1") return fallback;
    try {
      const t = this.train;
      const out = await this.#ask(
        `Second-price auction for one track segment: you pay the SECOND-highest bid, so bid your true value. ` +
        `Budget ${t.budget} tokens. Losing means waiting ~8 seconds while the winner clears the track. ` +
        `A heuristic values this segment at ${fallback}. What integer do you bid? Think briefly, then end with just the number.`,
        { maxTokens: 400, timeoutMs: 6000, thinking: true });
      const n = parseInt((String(out).match(/\d+/g) || []).at(-1), 10);
      const lo = Math.floor(fallback * 0.6), hi = Math.min(t.budget, Math.ceil(fallback * 1.5) + 2);
      if (Number.isFinite(n) && n >= lo && n <= hi) { this.llmWins++; return n; }
      this.llmFails++; this.lastReason = "bid-out-of-band";
    } catch { this.llmFails++; }
    return fallback;
  }

  async #ask(prompt, opts = {}) {
    this.calls++;
    const out = await complete(prompt, { maxTokens: 12, timeoutMs: TIMEOUT_MS, ...opts });
    if (out === null) throw new Error("llm unavailable");
    return out;
  }

  stats() {
    return { provider: providerSync().label, usingLLM: this.usingLLM, calls: this.calls, lastSteer: this.lastSteer, lastRaw: this.lastRaw ?? null, ok: this.llmWins, failed: this.llmFails, last: this.lastReason };
  }
}
