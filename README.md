# Midnight Express

**Forty trains. One network. Not enough track.** — HackCMU 2026

Everyone in the room scans one QR and gets a train with a destination and a deadline. The rail
network is deliberately under-built, so trains collide over track. Contested segments are
resolved by a live second-price auction **settled on Solana devnet** — each train co-signs its own
auction, so the Explorer page for your train lists exactly the auctions you were in. No app,
no wallet, no signup.

- A rival train is routed by **IFM K2 Horizon 0.9B, running locally** (no API key, no network).
- **Gemini** voices the dispatcher over the PA and writes the end-of-run report from the real scoreboard.
- Every run replays side by side against a **centralized dispatcher** that had full information — the room does 2–3× worse. That gap is the price of everyone acting in their own interest.

**Live:** https://155-138-204-133.sslip.io/play — open it on a phone, type a name, you're driving in five seconds.
**Pitch video (2:00):** in the submission Drive folder. **Sponsor evidence with transaction links:** `SPONSORS.md`.

## Run it

```bash
npm install
./scripts/start-ifm.sh            # K2 Horizon locally (needs IFM's llama.cpp fork; script explains)
LLM_PROVIDER=ifm CHAIN=memo npm start
# board: http://localhost:8080/   phone: the LAN URL it prints
```

Public front door (Vultr + Caddy + reverse tunnel): `./scripts/vultr-go.sh <ip> [hostname]`.
Pre-flight before a demo: `./scripts/preflight.sh`.

## Read

`STATUS.md` — what works, what doesn't, and the 12 bugs that only broke in front of a test ·
`DEMO.md` — the 3-minute pitch and judge Q&A · `DESIGN.md` — the design system ·
`LANES.md` — architecture, contracts, tuning knobs · `chain/README.md` — Solana / Anchor / ephemeral rollups

## Stack

Node + `ws` (20 Hz authoritative sim) · vanilla JS + canvas clients, no build step ·
`@solana/web3.js` on devnet, Anchor program with MagicBlock ER delegation (compiled, client-verified) ·
IFM K2 Horizon under `MBZUAI-IFM/llama.cpp` · Gemini via its OpenAI-compatible endpoint ·
Vultr + Caddy + Let's Encrypt.
