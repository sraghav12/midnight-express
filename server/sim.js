import { NODES, SEGMENTS, ADJ, segId, shortestPath, ORIGINS, DESTINATIONS } from "./network.js";

export const TICK_HZ = 20;

// ---------------------------------------------------------------------------
// PACING -- all env-tunable so it can be adjusted at the venue without a code edit.
//   SCARCITY        higher = trains hold segments longer = slower + more contention
//   AUCTION_SECONDS how long a sealed-bid window stays open
//   MIN_TRAFFIC     floor on total trains, topped up with filler freight
//   RUN_SECONDS     hard cap on a run
// Retuned 2026-09-12: was scarcity 2.5 / 3s auctions, which read as ~2.8s per
// segment and a 9-second journey. Far too fast to feel like anything.
// ---------------------------------------------------------------------------
export const DEFAULT_SCARCITY    = Number(process.env.SCARCITY || 7);
// 8s after a real-phone test: 5s was not enough to notice the buzz, read the
// screen and move the slider. Raise further if the room is slow, lower if bored.
export const AUCTION_TICKS       = Math.round(Number(process.env.AUCTION_SECONDS || 8) * TICK_HZ);
export const DEFAULT_MIN_TRAFFIC = Number(process.env.MIN_TRAFFIC || 10);
export const RUN_TICKS           = Math.round(Number(process.env.RUN_SECONDS || 180) * TICK_HZ);
export const START_BUDGET        = Number(process.env.START_BUDGET || 100);


// Transit-map line colours: saturated, distinct from each other on paper, and
// none of them the signal red the board reserves for contested track.
const COLORS = [
  "#0072BC", "#F28C00", "#00A651", "#7A4BC8", "#E5007E", "#00A3AD",
  "#8A6D3B", "#4C6EF5", "#C68A00", "#00776B", "#6B8E23", "#2C3E7A",
];

let seq = 0;
const nextId = (p) => `${p}${(++seq).toString(36)}`;

export class Run {
  constructor({ runId = nextId("r"), onEvent = () => {}, chain = null,
                scarcity = DEFAULT_SCARCITY, minTraffic = DEFAULT_MIN_TRAFFIC,
                policy = "auction" } = {}) {
    this.runId = runId;
    this.scarcity = scarcity;      // >1 = trains hold segments longer = more contention
    this.minTraffic = minTraffic;  // floor on total trains, topped up with agents
    this.policy = policy;          // "auction" (the game) | "central" (the baseline)
    this.tick = 0;
    this.phase = "lobby";           // lobby | running | ended
    this.trains = new Map();        // trainId -> train
    this.occupancy = {};            // segId -> trainId | null
    this.queues = {};               // segId -> [trainId] waiting to enter
    this.auctions = new Map();      // auctionId -> auction
    this.log = [];                  // replay telemetry
    this.onEvent = onEvent;
    this.chain = chain;
    for (const id of Object.keys(SEGMENTS)) {
      this.occupancy[id] = null;
      this.queues[id] = [];
    }
  }

  // -------------------------------------------------------------- joining
  addTrain({ name, isAgent = false } = {}) {
    const n = this.trains.size;
    const origin = ORIGINS[n % ORIGINS.length];
    // pick a destination that is actually reachable and not the origin
    const destination = DESTINATIONS[(n * 3 + 1) % DESTINATIONS.length];

    const train = {
      id: nextId("t"),
      name: name || `Train ${n + 1}`,
      color: COLORS[n % COLORS.length],
      isAgent,
      origin,
      destination,
      node: origin,               // current node when state === "at_node"
      seg: null,                  // current segment when state === "on_segment"
      from: null,
      to: null,
      progress: 0,
      state: "at_node",
      throttle: 1,
      steer: null,                // player's chosen next node
      budget: START_BUDGET,
      earned: 0,
      spent: 0,
      delayTicks: 0,
      arrivedTick: null,
      path: [],                   // actual node sequence taken, for the replay
      auctionsWon: 0,
      auctionsLost: 0,
    };
    train.path.push(origin);
    this.trains.set(train.id, train);
    return train;
  }

  /** Keep the network busy no matter how few humans are in the room.
   *  Filler trains are agents, so a 3-judge demo still shows real contention. */
  ensureMinimumTraffic() {
    let added = 0;
    while (this.trains.size < this.minTraffic) {
      this.addTrain({ name: `Freight ${added + 1}`, isAgent: true });
      added++;
    }
    return added;
  }

  // -------------------------------------------------------------- input
  /** The junction this train will next make a decision at: the node it stands on,
   *  or the one it is currently running toward. At ~8s per segment a player would
   *  otherwise have nothing to do for most of a leg, so pre-selecting in transit
   *  is what keeps the controller alive. */
  junctionNode(t) {
    return t.state === "on_segment" && t.to ? t.to : t.node;
  }

  /** Record the player's choice for the next junction. Accepted while held in an
   *  auction too -- it simply takes effect once the auction settles. */
  setSteer(trainId, toNode) {
    const t = this.trains.get(trainId);
    if (!t || t.state === "arrived") return false;
    if (!ADJ[this.junctionNode(t)]?.some((e) => e.to === toNode)) return false;
    t.steer = toNode;
    return true;
  }

  setThrottle(trainId, value) {
    const t = this.trains.get(trainId);
    if (!t) return false;
    t.throttle = Math.max(0, Math.min(1, Number(value) || 0));
    return true;
  }

  placeBid(trainId, auctionId, amount) {
    const a = this.auctions.get(auctionId);
    const t = this.trains.get(trainId);
    if (!a || !t || a.closed) return false;
    if (!a.bidders.some((b) => b.trainId === trainId)) return false;
    const amt = Math.max(0, Math.min(t.budget, Math.floor(Number(amount) || 0)));
    a.bids.set(trainId, amt);
    return true;
  }

  /** Auto-route: follow the shortest path unless the player steered. */
  desiredNext(t) {
    if (t.steer && ADJ[t.node].some((e) => e.to === t.steer)) return t.steer;
    const path = shortestPath(t.node, t.destination);
    return path && path.length > 1 ? path[1] : null;
  }

  // -------------------------------------------------------------- main loop
  step() {
    if (this.phase !== "running") return;
    this.tick++;

    this.resolveDueAuctions();
    this.advanceMoving();
    this.dispatchWaiting();

    if (this.tick % 10 === 0) this.recordTelemetry();

    const allIn = [...this.trains.values()].every((t) => t.state === "arrived");
    if (allIn || this.tick >= RUN_TICKS) this.end();
  }

  advanceMoving() {
    for (const t of this.trains.values()) {
      if (t.state !== "on_segment") continue;
      const seg = SEGMENTS[t.seg];
      t.progress += t.throttle / (seg.length * this.scarcity);
      if (t.throttle < 1) t.delayTicks += 1 - t.throttle;

      if (t.progress >= 1) {
        this.occupancy[t.seg] = null;
        t.node = t.to;
        t.path.push(t.to);
        t.seg = null; t.from = null; t.to = null; t.progress = 0;
        // keep a steer the player pre-selected for THIS junction; drop a stale one
        if (!ADJ[t.node].some((e) => e.to === t.steer)) t.steer = null;
        t.state = t.node === t.destination ? "arrived" : "at_node";
        if (t.state === "arrived") {
          t.arrivedTick = this.tick;
          this.onEvent({ t: "arrived", trainId: t.id, tick: this.tick, delayTicks: Math.round(t.delayTicks) });
        }
      }
    }
  }

  /** Every train sitting at a node tries to claim its next segment. */
  dispatchWaiting() {
    const requests = {};   // segId -> [trainId]
    for (const t of this.trains.values()) {
      // A bidder is locked into its auction until it settles: it accrues delay but
      // may not claim another segment meanwhile. Before this guard, steering away
      // mid-auction put the train onto a second segment; settlement then overwrote
      // t.seg and the first segment stayed "occupied" by a ghost for the whole run.
      if (t.state === "waiting") { t.delayTicks++; continue; }
      if (t.state !== "at_node") continue;
      const next = this.desiredNext(t);
      if (!next) continue;
      const sid = segId(t.node, next);
      if (this.auctionFor(sid)) { t.delayTicks++; continue; }  // already contested
      (requests[sid] ||= []).push(t.id);
    }

    for (const [sid, ids] of Object.entries(requests)) {
      const free = this.occupancy[sid] === null;
      if (!free) { for (const id of ids) this.trains.get(id).delayTicks++; continue; }

      if (ids.length === 1) {
        this.enterSegment(this.trains.get(ids[0]), sid);
      } else {
        this.openAuction(sid, ids);
      }
    }
  }

  enterSegment(t, sid) {
    const seg = SEGMENTS[sid];
    // A train can hold at most one segment. Release anything it still holds first,
    // so occupancy can never drift out of sync with where the trains actually are.
    if (t.seg && this.occupancy[t.seg] === t.id) this.occupancy[t.seg] = null;
    this.occupancy[sid] = t.id;
    t.state = "on_segment";
    t.seg = sid;
    t.from = t.node;
    t.to = seg.a === t.node ? seg.b : seg.a;
    t.progress = 0;
  }

  auctionFor(sid) {
    for (const a of this.auctions.values()) if (!a.closed && a.segmentId === sid) return a;
    return null;
  }

  openAuction(sid, trainIds) {
    // Centralized baseline: a single dispatcher with full information breaks the
    // tie instantly by global priority -- no 3s auction window, no delay for the
    // negotiation itself. This is what the room is measured against.
    if (this.policy === "central") {
      // Most-delayed first; ties keep boarding order (sort is stable). Never tie-break
      // on id strings: base-36 ids compare out of creation order once the global
      // counter passes 36, which made two identical replays disagree.
      const ranked = trainIds
        .map((id) => this.trains.get(id))
        .sort((a, b) => b.delayTicks - a.delayTicks);
      this.enterSegment(ranked[0], sid);
      for (const t of ranked.slice(1)) { t.state = "at_node"; t.delayTicks++; }
      return;
    }

    const auction = {
      id: nextId("a"),
      segmentId: sid,
      bidders: trainIds.map((id) => {
        const t = this.trains.get(id);
        return { trainId: id, name: t.name, budget: t.budget };
      }),
      bids: new Map(),
      openedTick: this.tick,
      closesAt: this.tick + AUCTION_TICKS,
      closed: false,
    };
    this.auctions.set(auction.id, auction);
    for (const id of trainIds) this.trains.get(id).state = "waiting";
    this.onEvent({ t: "auction", auction: this.auctionView(auction) });
    this.chain?.openAuction?.(this.runId, auction);
  }

  resolveDueAuctions() {
    for (const a of this.auctions.values()) {
      if (a.closed || this.tick < a.closesAt) continue;
      this.settleAuction(a);
    }
  }

  /**
   * Second-price (Vickrey): highest bidder takes the segment and pays the
   * SECOND-highest bid. That payment is split evenly among the losers as
   * compensation for their delay. Ties break toward the train with more
   * accumulated delay -- keeps the mechanism from starving anyone.
   */
  settleAuction(a) {
    a.closed = true;
    const entries = a.bidders.map((b) => ({
      trainId: b.trainId,
      amount: a.bids.get(b.trainId) ?? 0,
      delay: this.trains.get(b.trainId).delayTicks,
    }));
    entries.sort((x, y) => (y.amount - x.amount) || (y.delay - x.delay));

    const winner = entries[0];
    const pricePaid = entries.length > 1 ? entries[1].amount : 0;
    const losers = entries.slice(1);
    const share = losers.length ? Math.floor(pricePaid / losers.length) : 0;

    const wt = this.trains.get(winner.trainId);
    wt.budget -= pricePaid;
    wt.spent += pricePaid;
    wt.auctionsWon++;

    const compensation = {};
    for (const l of losers) {
      const lt = this.trains.get(l.trainId);
      lt.budget += share;
      lt.earned += share;
      lt.auctionsLost++;
      lt.state = "at_node";
      compensation[l.trainId] = share;
    }

    this.enterSegment(wt, a.segmentId);

    const view = {
      auctionId: a.id,
      segment: a.segmentId,
      winner: winner.trainId,
      winningBid: winner.amount,
      pricePaid,
      compensation,
      erSig: null,
    };
    this.onEvent({ t: "settled", settlement: view });
    this.chain?.settleAuction?.(this.runId, a, view);
    return view;
  }

  recordTelemetry() {
    this.log.push({
      tick: this.tick,
      trains: [...this.trains.values()].map((t) => ({
        id: t.id, node: t.node, seg: t.seg, progress: +t.progress.toFixed(3),
        state: t.state, budget: t.budget, delay: Math.round(t.delayTicks),
      })),
    });
  }

  // -------------------------------------------------------------- lifecycle
  start() {
    this.ensureMinimumTraffic();
    this.phase = "running";
    this.tick = 0;
    this.onEvent({ t: "started", runId: this.runId, trains: this.trains.size });
  }

  end() {
    if (this.phase === "ended") return;
    this.phase = "ended";
    const summary = this.summary();
    this.onEvent({ t: "runEnd", summary });
    this.chain?.finalizeRun?.(this.runId, summary);
  }

  summary() {
    const trains = [...this.trains.values()].map((t) => ({
      id: t.id, name: t.name, color: t.color, isAgent: t.isAgent,
      origin: t.origin, destination: t.destination,
      arrived: t.state === "arrived",
      arrivedTick: t.arrivedTick,
      delayTicks: Math.round(t.delayTicks),
      budget: t.budget, spent: t.spent, earned: t.earned,
      auctionsWon: t.auctionsWon, auctionsLost: t.auctionsLost,
      path: t.path,
    }));
    const humans = trains.filter((t) => !t.isAgent);
    const agents = trains.filter((t) => t.isAgent);
    const sum = (xs) => xs.reduce((s, t) => s + t.delayTicks, 0);
    return {
      runId: this.runId,
      ticks: this.tick,
      trains,
      scoreboard: {
        // The like-for-like number: EVERY train, self-interested. The baseline
        // replays every train too, so this is what it gets compared against.
        totalDelay: sum(trains),
        humanSwarmDelay: sum(humans),
        humanMeanDelay: humans.length ? Math.round(sum(humans) / humans.length) : 0,
        agentDelay: sum(agents),
        arrivedCount: trains.filter((t) => t.arrived).length,
        totalCount: trains.length,
      },
      auctions: [...this.auctions.values()].filter((a) => a.closed).length,
      log: this.log,
    };
  }

  // -------------------------------------------------------------- views
  auctionView(a) {
    return {
      auctionId: a.id,
      segment: a.segmentId,
      segmentName: `${NODES[SEGMENTS[a.segmentId].a].name} → ${NODES[SEGMENTS[a.segmentId].b].name}`,
      bidders: a.bidders.map((b) => ({ trainId: b.trainId, name: b.name, budget: b.budget })),
      openedTick: a.openedTick,
      closesAt: a.closesAt,
      msRemaining: Math.max(0, (a.closesAt - this.tick) * (1000 / TICK_HZ)),
    };
  }

  stateView() {
    return {
      t: "state",
      tick: this.tick,
      phase: this.phase,
      trains: [...this.trains.values()].map((t) => ({
        id: t.id, name: t.name, color: t.color, isAgent: t.isAgent,
        node: t.node, seg: t.seg, from: t.from, to: t.to,
        progress: +t.progress.toFixed(3), state: t.state, steer: t.steer,
        destination: t.destination, budget: t.budget,
        delay: Math.round(t.delayTicks),
      })),
      segments: this.occupancy,
      auctions: [...this.auctions.values()].filter((a) => !a.closed).map((a) => this.auctionView(a)),
    };
  }
}
