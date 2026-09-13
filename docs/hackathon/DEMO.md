# The 3-minute demo

Judging is **3 min presentation + demo**, 3 rooms, plus a 4:00–6:30 expo.
Rehearse this **out loud, on a timer, three times** before 3 PM. Under 3:00 or it gets cut.

## Setup before the judge arrives
- Screen open at `/` on the laptop, QR visible. **Volume up** — the dispatcher talks.
- `?mute` on the screen URL silences the voice if the room is already too loud.
- One teammate already joined on a phone (never demo to an empty network).
- `SCOREBOARD_HOLD_MS=20000` — the board auto-resets, so back-to-back judges just work.
- Backup video queued in another tab. **If the network is bad, play the video and narrate over it. Do not debug in front of a judge.**

## Script

| Time | Say / do |
|---|---|
| **0:00** | *"Everyone here — scan this."* Hand them nothing. They scan, they're driving a train in 5 seconds. No app, no wallet, no signup. |
| **0:15** | *"You each need to get home before midnight. This network does not have enough track."* |
| **0:35** | **Let it run.** Phones buzz. Point at the board: red segment = contested. *"Two trains want that track. You have three seconds to bid."* |
| **1:10** | *"Highest bidder goes. But they pay the **second** price — so bidding your true value is always your best move. The losers get paid for waiting."* |
| **1:40** | Point at the purple train. *"That one's a Grok agent. Same API you're using. It's beating you."* |
| **2:00** | Run ends. **Two replays play side by side at 10x**: the room gridlocking on the left, one dispatcher gliding the same trains home on the right. Let it run ~7s in silence, then the numbers. *"Same trains, same track. That gap is the price of everyone acting in their own interest."* |
| **2:20** | *"Now look at your phone."* Every phone has a Solana Explorer link to **the auctions they personally bid in**. They tap it. Real, devnet, 30 seconds old. |
| **2:45** | *"Second-price auctions for contested infrastructure, settling in ten milliseconds on Solana. Forty players, one QR."* Stop talking. |

**2:20 is the winning beat.** Do not rush it. Wait for them to actually tap the link.

## Questions they will ask

**"Why does this need a blockchain?"**
> Because the parties are adversaries. Every player wants the same track and has an incentive
> to misreport. A central server *could* run this auction — you'd just have to trust whoever
> owns it not to favour a train. On-chain, the bid, the clearing price and the compensation
> are all publicly verifiable by the loser. That's the property queues and central dispatchers
> don't have.

**"Whose transaction is that?"**
> Look at the signers. The treasury paid the fee, and the two trains in the auction
> co-signed it — the Memo program refuses any account that didn't. So the Explorer page
> for *your* train's address lists exactly the auctions you were in. No wallet, no app;
> the key was made for you when you scanned.

**"Is this actually real-time on-chain?"**
> The run's state is delegated to a MagicBlock ephemeral rollup — sub-50ms, zero fee — and
> committed back to devnet at arrival. Open the Explorer link; that's the real settled state.
> *(If Lane D fell back: be honest — "auction logic is on-chain via Memo receipts; the ER
> integration is the next step." Judges punish overclaiming far harder than scope.)*

**"Is the solver optimal?"**
> No. It's a centralized greedy dispatcher with full information, not a solved MAPF instance.
> We call it a baseline for that reason. CBS is the upgrade.

**"What's the real-world use?"**
> Rail slot allocation, airport landing slots, congestion pricing, GPU scheduling. All of them
> are contested resources allocated today by queues or a central authority.

**"Is the AI actually doing anything, or is it decoration?"**
> It's a player, not a narrator. It routes around congestion and bids its true value in
> the auction — second-price, so true-value bidding is provably its best move. We measured
> it: 48% less delay than a default train, and it beats every bidding style we tested,
> including people who go all-in every time.

**"Which model is it, and what does it actually do?"**
> IFM's K2 Horizon 0.9B, Apache 2.0, running on this laptop — no API key, no network
> call, so it works if the wifi dies. **It chooses the rival train's route.** At every
> junction it reads the options — distance to destination, which track is occupied —
> reasons for about two seconds, and picks. We log every decision; `/health` shows the
> count. The bid amounts come from a calibrated true-value rule, not the model: a
> 0.9B model asked for "an integer" will sometimes say zero and hand the track away.
> Say that plainly if asked. Judges reward knowing where your model is and isn't.

**"So which model does what?"**
> Three, each with a job it's actually good at. **K2 Horizon (IFM)**, running on this laptop,
> chooses the rival train's route at every junction — no key, no network. **Gemini** is the
> dispatcher's voice: it phrases every PA line and writes the end-of-run report from the real
> scoreboard, by name. A **centralized solver** is the baseline the room is measured against.
> None of them is a chatbot bolted on the side; take any one away and something visible stops.

**"Why not have the model bid too?"**
> We tried. With reasoning off it echoes whatever number you put in the prompt; with
> reasoning on it needs ~400 tokens and 3 seconds to answer an open-ended number. Routing
> is a choice between two or three options — exactly what a small model does well.
> There's a flag to turn model bidding on (`LLM_BIDS=1`) with a guardrail band; we ship
> it off.

**"Does it need your API keys to work?"**
> No, and that's deliberate. Both the rival train and the dispatcher voice run on their own
> logic with no key at all. A key upgrades the routing and the phrasing. We didn't want the
> best moment of the demo to depend on a preview API being up at 4pm.

**"What was hardest?"**
> Making contention *guaranteed* at any room size. With four players the network is empty and
> the mechanism is invisible; with forty it gridlocks. We added a scarcity multiplier and
> filler freight traffic so a single player still triggers around seven auctions.

## Submission form (paste-ready)

**Name:** Midnight Express
**Tagline:** Forty trains. One network. Not enough track.
**Track:** *(decide at 3 PM — Multiplayer, Optimization, or Traveling)*

**What it does:** Everyone in the room scans one QR and gets a train with a destination and a
deadline. The shared rail network is deliberately under-built, so trains collide over track.
Contested segments are resolved by a live three-second second-price auction settled on Solana,
with losers compensated for their delay. A Gemini Live dispatcher narrates in real time, a Grok
agent competes as a rival train, and each run is scored against a centralized dispatcher baseline.

**How we built it:** Node + ws authoritative 20 Hz simulation on Vultr; vanilla-JS phone
controller and canvas dispatch board with no build step; Anchor program with state delegated to
a MagicBlock ephemeral rollup; Gemini Live API for real-time audio; Grok 4.6 agentic tool-calling
and Grok Imagine for the world art.

**Challenges:** Guaranteeing contention across room sizes from 1 to 40 players; surviving venue
wifi (public WSS only, validated on cellular); keeping the game fully playable when any single
integration is down — every AI and chain path has a live fallback.
