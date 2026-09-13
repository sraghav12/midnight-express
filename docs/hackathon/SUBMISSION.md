# SUBMIT THIS — form due 4:00 PM — TEAM IS REMOTE

> **Do first, on Discord, right now:** ask the organizers (1) whether a remote team can be judged
> — Zoom/video slot — and (2) whether the form takes a demo-video link. Remote judging is not in
> the deck; do not assume. Whatever they say, submit the form on time.

**Project name:** Midnight Express
**Tagline:** Forty trains. One network. Not enough track.

**Track (pick ONE):** **IFM** — recommended (optional fifth track = fewest teams; our IFM K2 use
is real and local). Fallback: **Multiplayer**.

**Repo:** https://github.com/sraghav12/midnight-express
**Live (judges can open this on their own phones, right now):** https://155-138-204-133.sslip.io/play
**Demo video:** (record it — see below — paste link here)

## Try it in 30 seconds (paste this — judges are not at our table)

Open https://155-138-204-133.sslip.io/play on any phone. Type a name, tap **Board the train**.
Your train departs by itself; the map is on the board at the same host (`/`). When two trains
want the same track, your phone takes over for an 8-second sealed bid. At the end, tap **View
your bids on Solana** — real devnet transactions your train co-signed. If a run is already
going, you join it; if one just ended, the lobby reopens within 20 seconds. Several people at
once is the point.

## Description (paste)

Everyone scans one link and gets a train with a destination and a deadline. The rail network is
deliberately under-built, so trains collide over track. Contested segments are resolved by a
live 8-second second-price auction settled on Solana devnet — each train co-signs its own
auction, so the Explorer page for your train lists exactly the auctions you were in. No app, no
wallet, no signup. A rival train is routed by IFM's K2 Horizon 0.9B running locally on our
laptop (no API key, no network). Gemini voices the dispatcher over the PA; Grok files the
end-of-run report from the real scoreboard; Grok Imagine painted the board. Every run replays
side by side against a centralized dispatcher that had full information — the room does 2–3×
worse. That gap is the price of everyone acting in their own interest.

## How we built it (paste)

Node + ws authoritative 20 Hz simulation; vanilla-JS phone controller and canvas dispatch board,
no build step; Solana devnet via @solana/web3.js with per-train ephemeral keypairs; an Anchor
program with MagicBlock ephemeral-rollup delegation (compiled and client-verified, deploy pending
devnet funds); IFM K2 Horizon under IFM's llama.cpp fork (stock Ollama cannot load the
architecture); Gemini and xAI via OpenAI-compatible endpoints; Vultr + Caddy + Let's Encrypt as
the HTTPS front door with an SSH reverse tunnel to the laptop, because CMU wifi wildcard-blocks
throwaway tunnel hostnames.

## Sponsor prizes to tick

Best Use of Solana · Best Use of Gemini API · IFM Prize · Cursor/SpaceXAI Prize (Grok + Grok
Imagine) · Best Use of Vultr · Best Design / People's Favorite (voted)

## Demo video — record this now (QuickTime → File → New Screen Recording), 2–3 min

1. Board at `http://localhost:8080/` full screen, volume up so the dispatcher is audible.
2. 3–4 teammates open the live URL on phones — different cities is a *better* story.
3. Let a run play to the scoreboard and the recap. Then hold a phone up to the camera (or
   screen-record the phone) tapping **View your bids on Solana**.
4. Upload unlisted to YouTube or Drive (anyone with link). Paste the link in the form.
Script to speak over it: `DEMO.md`, first table — cut to 2 minutes.
