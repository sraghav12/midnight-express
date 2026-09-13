# MIDNIGHT EXPRESS — lane assignments

*Forty trains. One network. Not enough track.*
HackCMU 2026 · submission **4:00 PM Saturday** · full plan in `~/.claude/plans/fluffy-seeking-valley.md`

## Run it

```bash
npm install
npm start                       # screen: http://localhost:8080/   phone: /play
node scripts/loadtest.js 12     # fake 12 phones, prints PASS/FAIL
./scripts/g1-check.sh wss://<public-host>
```

Env: `PORT`, `PUBLIC_URL` (what the QR encodes), `GEMINI_API_KEY`, `XAI_API_KEY`, `DISPATCHER_MODE`.
**`.env` is honoured** (copy `.env.example`; real env vars win over it). It is loaded by
`server/env.js`, which **must stay the first import in `server/index.js`** -- `sim.js`, `llm.js`
and `agent.js` read env into constants at module load, and ES imports run before the importing
file's own code. Put a new import above it and every `.env` value silently stops applying.

**Turn the chain on:**
```bash
CHAIN=memo npm start          # real Solana devnet writes
npm start                     # off-chain stub (default)
```
**BLOCKED ON A HUMAN:** the devnet faucet is rate-limited, so the treasury is empty.
Fund `48sFG5ydaaEpME7bdfyAUGw6Aj6KqVyyEf4CuGY5ngaD` at <https://faucet.solana.com>
(devnet, 1 SOL is plenty) and every auction starts writing on-chain automatically.
Check with `curl localhost:8080/health | jq .chain`.

**Turn on the local IFM brain (no key, no network — preferred):**
```bash
./scripts/start-ifm.sh          # IFM K2 Horizon 0.9B on :8090, ~20s to load
LLM_PROVIDER=ifm npm start
```
Stock Ollama CANNOT load this — `unknown model architecture: 'k2-horizon'`. It needs
IFM's llama.cpp fork, which `start-ifm.sh` checks for and tells you how to build.
K2 is a reasoning model. Thinking OFF (~0.15s) rewrites text fine but **does not decide** —
asked to pick an option it echoes the prompt. Thinking ON (~2s) picks correctly. So: the
dispatcher's rephrasing runs thinking-off; the rival's route choice runs thinking-on, once
per junction. Bids are heuristic (`LLM_BIDS=1` to let the model move them within a band).

**Turn the rival train on:**
```bash
XAI_API_KEY=xai-... npm start   # rival is named "Grok" and routes/bids via grok-4.6
npm start                       # rival is named "Dispatcher", same heuristic brain
```
It plays well with no key at all — the key upgrades it, it is not required.
Gemini works the same way: `LLM_PROVIDER=gemini GEMINI_API_KEY=... npm start` → rival named "Gemini".

**Pacing knobs — no code edit needed, tune at the venue:**
```bash
SCARCITY=7 AUCTION_SECONDS=8 MIN_TRAFFIC=10 RUN_SECONDS=180 npm start
```
`SCARCITY` is the big one: 2.5 gave ~2.8s per segment (a 9-second journey, far too fast).
7 gives ~8s per segment and a ~24s journey. Raise it for slower, tenser runs.

**`localhost` does not work on a phone** — it means the phone itself. The boot banner prints
the LAN URL to use; for the real demo set `PUBLIC_URL` to your public https URL.

## What already works (Lane A core, done)

- 12-node rail network, 17 segments, capacity 1 each. Oakland is degree-5 = the chokepoint.
- 20 Hz authoritative sim, 10 Hz broadcast. Verified: 12 clients, 0 errors, p95 gap 104ms.
- **Second-price auctions.** Verified by hand: bid 30 → pays 16 (second price) → 8+8 to losers.
- Filler agent traffic so even **one** human still triggers ~7 auctions. `DEFAULT_MIN_TRAFFIC = 10`.
- Auto-routing: a judge who taps nothing still travels. Nobody can be stuck.
- Centralized baseline: swarm loses by **2.2–2.7×**. That's the Optimization punchline.
- Phone client + dispatch-board screen + server-rendered QR (no CDN dependency).
- **Pre-steering while in transit** — at 8s/segment the choice panel was dead air; you now
  commit to your next track before you arrive.
- **Rival agent train** — congestion-aware routing + true-value Vickrey bidding. Measured
  48% less delay than a default train, and it beats every opponent model tested
  (timid / casual / keen / sharp / all-in).
- **Solana adapter** (`chain/solana-memo.js`) — wallet-less ephemeral keypair per train,
  one Memo tx per settled auction, a run receipt at arrival, Explorer links pushed to each
  player's phone. Self-disables and never blocks the game when the RPC is down or unfunded.
- **Anchor program** (`chain/midnight_express/`) — RunState PDA, ER delegation,
  second-price `settle_auction`, commit + undelegate.

## Lanes

| Lane | Owner | Files | First task |
|---|---|---|---|
| **A · sim** | | `server/sim.js` `network.js` `index.js` | Tune `DEFAULT_SCARCITY` / `DEFAULT_MIN_TRAFFIC` during the 11:30 load test — **not before** |
| **B · clients** | | `public/phone.html` `public/screen.html` `public/tokens.css` | Design system + end-of-run side-by-side replay **DONE**. Next: polish only |
| **C · AI** | | `server/agent.js` `server/dispatcher.js` `server/llm.js` | **DONE.** Rival train + dispatcher run on IFM K2 (local), xAI, or Gemini — one env var. Remaining only if time: Gemini Live native audio |
| **D · chain** | | `chain/` | **Toolchain installed. Memo adapter DONE.** Remaining: fund the treasury, deploy the Anchor program. See `chain/README.md` |

## Frozen contracts — `server/contracts.js`. Do not change without telling all four lanes.

```jsonc
// A -> D, on each contested segment
{ "runId":"r7", "auctionId":"a19", "segment":"BRD-EAS",
  "bidders":[{"train":"t3","budget":72},{"train":"t9","budget":40}], "closesAt": 1757640000 }

// D -> A, on settle
{ "auctionId":"a19", "winner":"t3", "pricePaid":41, "compensation":{"t9":41}, "erSig":"5xK..." }

// D -> A, once at arrival
{ "runId":"r7", "sig":"9mP...", "explorerUrl":"https://explorer.solana.com/tx/9mP...?cluster=devnet" }
```

Lane D's only integration surface is swapping `ChainStub` for the real adapter in `server/index.js`.

## Gates — these are real, not suggestions

| Gate | When | Test |
|---|---|---|
| **G1** | 11:30 PM | A phone on **cellular, wifi off** holds a WSS connection to the public host. Fail → switch hosts immediately, do not debug past midnight. |
| **G2** | 2:30 AM | Stock `anchor-counter` delegating + committing on devnet ER. Fail → Anchor escrow → (5:30 AM) → Memo receipts. |
| **G3** | 5:30 AM | Playable end to end, or drop the auction and ship the co-op subset. |
| **G4** | 1:00 PM | **FEATURE FREEZE.** Backup video recorded *first*, then three timed rehearsals under 3:00. |

## Track decision — 3:00 PM

Valid for **Multiplayer**, **Optimization**, and **Traveling**. Walk the expo, pick the weakest room.

## Say this to judges

> *Contested infrastructure — rail slots, landing slots, road pricing, GPU scheduling — is
> allocated today by queues and central authorities. We built a live, verifiable, second-price
> market for it that settles in ten milliseconds, and we can put forty strangers inside it in
> five seconds. The trains are the demo. The mechanism is the point.*

And when they ask about the baseline: it is a **centralized greedy dispatcher**, not a solved
MAPF instance. Say that. Precision reads better than an inflated claim.
