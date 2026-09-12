/**
 * LANE C — the dispatcher voice.
 *
 * Same rule as the rival train: it must work with NO API KEY, and be better with
 * one. A demo whose best moment depends on a preview API is a demo that can die
 * at 4pm.
 *
 *   no key  -> rule-based announcer, spoken by the big screen's SpeechSynthesis
 *   key     -> the same events phrased by Gemini, spoken the same way
 *
 * It reads the sim and emits short lines. It never blocks the tick loop, and it
 * shuts up when there is nothing to say -- a dispatcher that narrates constantly
 * is noise, and the room is already loud.
 */
import { NODES, SEGMENTS } from "./network.js";
import { AUCTION_TICKS, TICK_HZ } from "./sim.js";
import { complete, providerSync } from "./llm.js";

const MIN_GAP_MS = Number(process.env.DISPATCH_MIN_GAP_MS || 4500);
const MODE = process.env.DISPATCHER_MODE || "auto";   // auto | rules | off
// Which model phrases the voice. Default: whatever the rival uses (K2). Set
// DISPATCHER_PROVIDER=gemini to give the dispatcher its own model -- two models,
// two honest sponsor claims: K2 routes the rival, Gemini speaks over the PA.
const VOICE_PROVIDER = process.env.DISPATCHER_PROVIDER || null;
// The end-of-run report can come from a different model than the PA lines --
// e.g. RECAP_PROVIDER=xai lets Grok file the report while Gemini works the PA.
const RECAP_PROVIDER = process.env.RECAP_PROVIDER || VOICE_PROVIDER;

export class Dispatcher {
  constructor({ run, say = () => {}, apiKey = process.env.GEMINI_API_KEY } = {}) {
    this.run = run;
    this.say = say;
    this.apiKey = apiKey;
    this.lastAt = 0;
    this.seenAuctions = new Set();
    this.announcedArrival = new Set();
    this.departed = false;
    this.spoken = 0;
  }

  get enabled() { return MODE !== "off"; }
  get usingLLM() { return MODE !== "rules" && Boolean(this.apiKey); }

  #emit(text, priority = false) {
    if (!this.enabled || !text) return;
    const now = Date.now();
    if (!priority && now - this.lastAt < MIN_GAP_MS) return;
    this.lastAt = now;
    this.spoken++;

    // Urgent lines (auction open, departure, arrival) go out verbatim and instantly.
    // Colour lines get one shot at being rephrased by whatever model is driving;
    // on any failure or timeout the rule-based line is what gets said.
    if (priority || (providerSync().provider === "none" && !VOICE_PROVIDER)) { this.say(text); return; }
    complete(
      `You are a terse 1920s railway dispatcher announcing over a station PA. ` +
      `Rewrite this in ONE sentence, under 16 words, keep every name and number exactly: "${text}"`,
      { maxTokens: 40, timeoutMs: 2500, temperature: 0.7, provider: VOICE_PROVIDER },
    ).then((out) => {
      const line = (out || "").trim().replace(/^["']|["']$/g, "");
      this.say(line && line.length < 140 ? line : text);
    }).catch(() => this.say(text));
  }

  /** Called when an auction opens. Highest-value line in the whole demo. */
  onAuction(auction) {
    if (this.seenAuctions.has(auction.auctionId)) return;
    this.seenAuctions.add(auction.auctionId);
    const seg = SEGMENTS[auction.segment];
    const where = seg ? NODES[seg.b].name : "the junction";
    const who = auction.bidders.map((b) => b.name);
    this.#emit(
      who.length === 2
        ? `Track contested at ${where}. ${who[0]} against ${who[1]}. ${Math.round(AUCTION_TICKS / TICK_HZ)} seconds.`
        : `${who.length} trains contesting ${where}. Bid now.`,
      true,
    );
  }

  onSettled(s, run) {
    const w = run.trains.get(s.winner);
    if (!w) return;
    const losers = Object.keys(s.compensation).map((id) => run.trains.get(id)?.name).filter(Boolean);
    if (!losers.length) return;
    this.#emit(`${w.name} takes it for ${s.pricePaid}. ${losers[0]} held and compensated.`);
  }

  onArrived(train) {
    if (this.announcedArrival.has(train.id)) return;
    this.announcedArrival.add(train.id);
    if (train.isAgent) return;                       // freight arrivals are not news
    this.#emit(`${train.name} is home at ${NODES[train.destination].name}.`);
  }

  onDeparture(count) {
    if (this.departed) return;
    this.departed = true;
    this.#emit(`The Midnight Express is away. ${count} trains on the network. Not enough track.`, true);
  }

  /** Periodic colour, only when something is actually wrong. */
  tick() {
    if (!this.enabled || this.run.phase !== "running") return;
    const stalled = [...this.run.trains.values()]
      .filter((t) => t.state === "waiting" && !t.isAgent)
      .sort((a, b) => b.delayTicks - a.delayTicks);
    if (stalled.length >= 2) {
      this.#emit(`${stalled.length} trains held at signals. Somebody is going to have to pay.`);
    } else if (stalled.length === 1 && stalled[0].delayTicks > 200) {
      this.#emit(`${stalled[0].name} is still waiting. Bid higher or take the long way.`);
    }
  }

  /**
   * Run-end recap: one open-ended generation from the real scoreboard. Latency is
   * irrelevant here, so this is the right job for a cloud model. Spoken AND sent
   * to the board as the verdict subtitle. Falls back to the rule-based line.
   */
  recap(summary) {
    if (!this.enabled || !RECAP_PROVIDER) return;
    const sb = summary.scoreboard; const b = summary.baselineDelay;
    const humans = (summary.trains || []).filter((t) => !t.isAgent);
    const best = humans.slice().sort((x, y) => x.delayTicks - y.delayTicks)[0];
    const worst = humans.slice().sort((x, y) => y.delayTicks - x.delayTicks)[0];
    const everyone = Math.round(sb.totalDelay / TICK_HZ);
    const central = b ? Math.round(b / TICK_HZ) : null;
    const facts = {
      trains: sb.totalCount, humans: humans.length,
      // Spell the comparison out in words: a model given two bare numbers will
      // happily praise the slow side. The dispatcher being FASTER is the punchline.
      comparison: central
        ? `Everyone routing themselves lost ${everyone} seconds in total. One central dispatcher, given the same trains, would have lost only ${central} seconds -- ${(sb.totalDelay / b).toFixed(1)} times better. Self-interest cost the room ${everyone - central} seconds.`
        : `Everyone routing themselves lost ${everyone} seconds in total.`,
      auctions: summary.auctions,
      rival: summary.rival ? { name: summary.rival.name, delaySeconds: Math.round(summary.rival.delayTicks / TICK_HZ) } : null,
      bestHuman: best ? { name: best.name, delaySeconds: Math.round(best.delayTicks / TICK_HZ), auctionsWon: best.auctionsWon } : null,
      mostDelayed: worst ? { name: worst.name, delaySeconds: Math.round(worst.delayTicks / TICK_HZ), auctionsLost: worst.auctionsLost } : null,
    };
    complete(
      `You are the dispatcher of the Midnight Express, a 1920s night train, filing the end-of-run report over the station PA. ` +
      `Write TWO short sentences (under 40 words total) from these facts only, dry and a little wry. ` +
      `Sentence 1: the comparison, keeping its direction exactly (the central dispatcher was faster). ` +
      `Sentence 2: one human by name. Do not invent numbers.\n${JSON.stringify(facts)}`,
      // Latency is free here: the board holds the scoreboard for 20s. grok-4.3 needs ~4-8s.
      { maxTokens: 90, timeoutMs: 14000, temperature: 0.8, provider: RECAP_PROVIDER },
    ).then((out) => {
      // Grok likes **bold** and a "Report:" label; the PA does not.
      const line = (out || "").replace(/\*\*|__|^#+\s*/g, "").replace(/^\s*(end[- ]of[- ]run\s+report[:.]?)\s*/i, "").trim().replace(/\s+/g, " ");
      if (line && line.length < 320) { this.spoken++; this.say(line, { kind: "recap" }); }
    }).catch(() => {});
  }

  onRunEnd(summary) {
    this.recap(summary);
    const total = summary.scoreboard.totalDelay;
    const b = summary.baselineDelay;
    if (b && b > 0 && total > 0) {
      const r = total / b;
      this.#emit(r >= 1.15
        ? `All in. One dispatcher would have done that with ${r.toFixed(1)} times less delay. You were all being selfish.`
        : `All in. You matched a central dispatcher. That almost never happens.`, true);
    } else {
      this.#emit("All trains in.", true);
    }
  }

  stats() {
    return { enabled: this.enabled, mode: MODE, usingLLM: this.usingLLM, lines: this.spoken };
  }
}
