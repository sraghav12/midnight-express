# Midnight Express — status

*Updated 2026-09-12, 4:52 PM. **CODE FROZEN.** Team remote; judged by video at 5:05 PM.*

**Pitch video (HyperFrames, 2:00):** `~/Desktop/CMU/Sem 3/HackCMU/midnight-express-pitch-hyperframes.mp4` —
real footage of a live run recorded with Playwright (`scripts/pitch/record.mjs`), composed by
`scripts/pitch/hf-build.mjs` into a HyperFrames composition (title → board + phone with captions →
Solana Explorer close-up → end card), narration via macOS `say`, rendered by `hyperframes render`
in 2m51s. Safe fallback cut (ffmpeg, no cards): `midnight-express-pitch.mp4`, 116 s. Repo: https://github.com/sraghav12/midnight-express · Live: https://155-138-204-133.sslip.io/play*

## Works right now, no keys, no funding

```bash
npm start                     # board on localhost:8080, phone on the LAN URL it prints
node scripts/loadtest.js 12   # fake 12 phones, prints PASS/FAIL
```

- 12-station network, 17 segments, capacity 1. Oakland is the degree-5 chokepoint.
- 20 Hz authoritative sim, 10 Hz broadcast. p95 broadcast gap ~104ms, 0 socket errors.
- Second-price auctions, hand-verified: bid 30 -> pays 16 -> 8+8 to losers.
- Contention guaranteed at any room size — one human still triggers ~7 auctions.
- **Rival agent train**: 48% less delay than a default train. Beats all 5 bidding styles tested.
- **Dispatcher voice**: 13 contextual lines per run, spoken by the board. No key needed.
- **IFM K2 Horizon 0.9B running LOCALLY** — no API key, no network. **It routes the rival
  train**: one reasoning call per junction (~2s), picks among the real options. Bids stay on
  the calibrated rule. `./scripts/start-ifm.sh` then `LLM_PROVIDER=ifm npm start`.
  `/health` → `agent.ok` counts model decisions that landed.
- Centralized baseline: the room loses by 2.2–2.7×. That's the Optimization punchline.
- Runs auto-reset, so judges cycle through the expo table without anyone touching it.
- **End-of-run replay**: both sides of the run play back side by side at 10x — the room
  gridlocking next to one dispatcher gliding the same trains home — above the scoreboard.
- Auction window is **8s** (5s was too short with real thumbs). `AUCTION_SECONDS` to tune.

## Needs a human, ~5 minutes total

| What | Who | Why |
|---|---|---|
| **G1 cellular test** | anyone | `./scripts/g1-check.sh wss://<host>`, then `/play` on a phone with **wifi off**. The one thing that can invalidate everything else. |
| **Fund 2 devnet addresses** | anyone | faucet is rate-limiting the machine. See below. |
| **xAI + Gemini keys** | anyone | sponsor expo tables. $25 free xAI credits. |
| **Play one real run** | the team | everything so far is verified by simulated clients, not a human thumb. |

### The two addresses (faucet.solana.com, devnet)
```
48sFG5ydaaEpME7bdfyAUGw6Aj6KqVyyEf4CuGY5ngaD   ~1 SOL     memo treasury
DQsaAakQVQGcVWz6ZQR4uyvm1hxiX6KJYnt1wC1whFas   ~2.5 SOL   program deploy
```
Then: `CHAIN=memo npm start`  ·  or the full path: `./scripts/deploy-chain.sh`

## Chain state

- **END TO END VERIFIED (03:15):** live 4-phone run with `CHAIN=memo` → 8 auctions written to
  devnet, Explorer links delivered to phones, run receipt on board and phone, K2 routing 2/2.
- `chain/solana-memo.js` — **LIVE on devnet.** Wallet-less ephemeral keypair per train, one
  Memo tx per settled auction **co-signed by the trains in it**, run receipt at arrival,
  Explorer links pushed to each phone. Treasury `48sFG5…ngaD` funded (1 SOL ≈ thousands of
  writes). Self-disables when unfunded; never blocks the game. `CHAIN=memo npm start`.
- `chain/anchor-adapter.js` — written, **offline-tested against the IDL** (PDA derivation,
  instruction encoding, account decode). `CHAIN=anchor npm start` once deployed. Untested
  on-network until the deploy wallet is funded.
- `chain/midnight_express/` — **compiles**, not yet deployed. 309KB `.so` + IDL. Deploy needs
  **3.3 SOL** in `DQsaAa…hFas` (3.14 rent-exempt for the program account + fees); it has 1. Instructions:
  `initialize_run`, `delegate_run`, `settle_auction`, `commit_run`, `undelegate_run`,
  plus `process_undelegation` injected by `#[ephemeral]` — the ER wiring is confirmed.
  Only deployment is left, and that is blocked on funding.
- Toolchain: rustc 1.98.1, solana-cli 3.1.10, anchor-cli 1.0.2.

## Sponsor coverage

| Sponsor | Status |
|---|---|
| **IFM** | K2 Horizon 0.9B local. Unlocks the IFM prize AND makes us eligible for the IFM **track**. |
| **Solana** | Memo adapter done; Anchor + ER program compiles. Needs funding. |
| **SpaceXAI** | Wired (`LLM_PROVIDER=xai` or `DISPATCHER_PROVIDER=xai`). **Key in .env is NOT an API key** (starts `SPAC…`, xAI keys start `xai-`) — get one at console.x.ai. |
| **Gemini** | **LIVE.** `DISPATCHER_PROVIDER=gemini` — Gemini phrases every PA line and writes the run-end recap from the real scoreboard (board + voice). Model `gemini-flash-lite-latest` (the 2.5 names 404 for new keys). K2 still routes the rival: two models, two honest claims. |
| **Vultr** | Not used — **ask at the table for credits**, it is a prize and our real demo host. |
| **ElevenLabs / MongoDB / Auth0** | Not used. ~30 min each if time allows. |
| **Querit** | Tabling with no listed prize — likely free keys. Web search for agents. |

**Track choice is now FOUR options**, decided at 3 PM by which room looks weakest:
Multiplayer · Optimization · Traveling · **IFM**.

## Pre-flight — run this at 1 PM and again at 3:45 PM

```bash
./scripts/preflight.sh
```
14 PASS/FAIL lines: this wifi resolves the hostname, HTTPS + cert, brain/voice/chain flags,
`/play` served, QR target, tunnel + server + K2 processes, treasury balance, AC power, sleep
prevention. Anything FAIL → fix, or `./scripts/vultr-go.sh 155.138.204.133`. First run caught
that the laptop could sleep and kill the tunnel; `caffeinate` now starts with the tunnel.

## Network — read this before the expo

`./scripts/go-public.sh` gives a public URL in one command and **G1 passed on cellular**.
But **CMU wifi wildcard-blocks `*.trycloudflare.com`** (local DNS returns NXDOMAIN; 1.1.1.1
resolves it fine). A judge who scans the QR while on campus wifi gets nothing. The tunnel
is for testing only. **The expo needs a real host + domain — get Vultr credits at the table.**

**FRONT DOOR IS LIVE (03:10): https://155-138-204-133.sslip.io/play** — Vultr `155.138.204.133`
(Atlanta, Ubuntu 26.04), Caddy + Let's Encrypt, reverse tunnel to the laptop. Verified: HTTPS 200,
valid cert, `/play` served, chain enabled, QR encodes it. **CMU's resolver resolves sslip.io**
(unlike trycloudflare) — checked from campus wifi — so judges on campus wifi can reach it.
A `.tech` domain is now optional. **To (re)start the whole thing from the laptop:**
```bash
CHAIN=memo LLM_PROVIDER=ifm ./scripts/vultr-go.sh 155.138.204.133
```
Leave that terminal open for the expo. Ctrl-C stops everything. Re-runs skip the install.

**Vultr topology (decided):** Vultr is the HTTPS front door only. A cheap VPS cannot run K2's
reasoning fast enough, so the game server, K2 and the board stay on the laptop and reach Vultr
over an SSH reverse tunnel. Caddy on Vultr terminates TLS on a real hostname.
1. `scripts/vultr-setup.sh <hostname>` — run ON the instance once (Caddy, firewall, sshd)
2. `scripts/vultr-tunnel.sh root@<ip> <hostname>` — run on the laptop; replaces go-public.sh
Hostname: a real domain (MLH table hands out .tech) with an A record to the IP; fallback
`<ip-with-dashes>.sslip.io` needs no DNS setup. Test from a phone ON CMU WIFI.
Credits: $100, no card — mlh.link/vultr-signup, then a Gift Code from the MLH Coach.

## Still not built

- Gemini Live **audio** — the voice is browser SpeechSynthesis; Gemini/K2 phrase the lines
- Grok Imagine artwork
- MongoDB / Auth0 (optional prizes, ~30 min each)
- Backup demo video (record at 1 PM, before rehearsing)

## Bugs found and fixed overnight

Each of these would only have shown up in front of a judge:

1. **Second run impossible** — after a run ended the next group hit a dead lobby. Fatal at a
   2.5-hour expo. Now auto-resets.
2. **Silent on iPhone** — iOS Safari has no Vibration API, so the auction alert did nothing.
   Now a WebAudio chime plus the visual takeover.
3. **In-transit dead zone** — at 8s/segment the phone's choice panel sat blank most of a leg.
   Now you pre-select your next track while moving.
4. **Blocking chain init** — `await chain.init()` stopped the server listening.
5. **`auctionSig` unhandled** — the per-auction Explorer links, the 2:20 demo beat, never rendered.
6. **Agent was 16% worse than useless** — it priced the detour delta instead of the wait
   avoided, so it bid ~8 against opponents bidding 0–40 and lost nearly every auction.
7. **Scoreboard compared apples to oranges** — human-only delay vs the baseline's all-trains
   delay. On a real run it read "0.5× faster" (i.e. the dispatcher LOST). Now like for like:
   every train self-interested vs every train under one dispatcher. Same run: 2.8×.
8. **K2 bid zero** — the 0.9B model, asked for "an integer", sometimes answers 0 and hands the
   track away. LLM bids are now off by default (`LLM_BIDS=1` enables, band-guarded).
9. **K2 was making zero decisions.** With reasoning disabled it *echoes the prompt* — every
   one of 123 "inference calls" in an earlier run was rejected as invalid, so the "K2-driven
   rival" was 100% heuristic. With reasoning on it picks the right route 4/4 in ~2s. Now: one
   reasoning call per junction, never overlapping; the count is on `/health`. Do not claim
   more than this to the IFM judges.
13. **Run receipt too large for Solana.** With 8 co-signers and a 12-train crew JSON the receipt
    hit `Transaction too large: 1270 > 1232` — the closing "View this run on Solana" link never
    appeared while every per-auction link did. Measured: 8 co-signers = exactly 1232 bytes with a
    286-byte memo. Now: up to 4 human co-signers (844 bytes), treasury-only fallback (456). Plus one
    retry on a failed auction write. **Verified live 3:55 PM: receipt on board and phone, 8/8 writes.**
    https://explorer.solana.com/tx/3z65SAMLTuTxA4q9EdynpKMvBe8ChizQwBvAyPZDdXF7ft8ac3mmzk29vPEKJsgim8SCYy8v69xmXaogZtnxqasy?cluster=devnet
12. **The `.env` move took the chain down.** The template line `TREASURY_SECRET_KEY=   # base58…`
    (empty value + comment) was loaded as the literal string `# base58…`; the memo adapter
    `JSON.parse`d it and disabled itself. Loader now treats comment-only values as empty, and a
    malformed secret falls back to the key file instead of killing the chain. Caught only because
    I re-checked `/health` after the restart instead of trusting the "HTTP 200".
11. **`.env` was silently ignored.** The server never read it, and once it did, values read at
    module load (`AUCTION_SECONDS`, `LLM_PROVIDER`, `SCARCITY`...) still used defaults because
    imports evaluate before the loader ran. Fixed with `server/env.js` imported first; verified
    a module-load constant (auction window 8→11 s) now comes from `.env`.
10. **Every on-chain write failed** the first time the treasury was funded: `MissingRequiredSignature`.
    The Memo program requires every account passed to it to be a signer, and the trains'
    ephemeral pubkeys were passed as read-only non-signers for attribution. Fix: the trains
    **co-sign** their own auctions (the server holds the keypairs). Explorer now shows
    `Signed by <train>` — the honest version of "your bids are on-chain."
    First confirmed write: explorer.solana.com/tx/5oPtZiKc...?cluster=devnet

## Docs

`LANES.md` lanes + contracts · `DEMO.md` pitch + judge Q&A · `DESIGN.md` style guide ·
`chain/README.md` Lane D · plan at `~/.claude/plans/fluffy-seeking-valley.md`
