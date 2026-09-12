# SUBMIT THIS — form due 4:00 PM

**Project name:** Midnight Express
**Tagline:** Forty trains. One network. Not enough track.

**Track (pick ONE):** **IFM** — recommended. It is the optional fifth track, so the least
crowded, and we use IFM's K2 Horizon for real: running locally on a llama.cpp fork we built,
choosing the rival train's route at every junction. If the form's IFM description demands more
than "built with IFM models", fall back to **Multiplayer** (our strongest thematic fit).

**Live demo (works on CMU wifi):** https://155-138-204-133.sslip.io/play
**Board:** open `http://localhost:8080/` on the laptop running the tunnel.
**Repo:** https://github.com/sraghav12/midnight-express

## Description (paste)

Everyone in the room scans one QR and gets a train with a destination and a deadline. The rail
network is deliberately under-built, so trains collide over track. Contested segments are
resolved by a live 8-second second-price auction settled on Solana devnet — each train co-signs
its own auction, so the Explorer page for your train lists exactly the auctions you were in.
No app, no wallet, no signup. A rival train is routed by IFM's K2 Horizon 0.9B running locally
on the laptop (no API key, no network). Gemini voices the dispatcher over the PA and writes the
end-of-run report from the real scoreboard. Every run is replayed side by side against a
centralized dispatcher that had full information — the room typically does 2–3× worse. That gap
is the price of everyone acting in their own interest.

## How we built it (paste)

Node + ws authoritative 20 Hz simulation; vanilla-JS phone controller and canvas dispatch board
with no build step; Solana devnet via @solana/web3.js with per-train ephemeral keypairs; an
Anchor program with MagicBlock ephemeral-rollup delegation (compiled and client-verified, deploy
pending devnet funds); IFM K2 Horizon under IFM's llama.cpp fork (stock Ollama cannot load the
architecture); Gemini via its OpenAI-compatible endpoint; Vultr + Caddy + Let's Encrypt as the
HTTPS front door with an SSH reverse tunnel to the laptop, because CMU wifi wildcard-blocks
throwaway tunnel hostnames.

## Sponsor prizes to tick

Best Use of Solana · Best Use of Gemini API · IFM Prize · Best Use of Vultr · (Best Design,
People's Favorite are voted)

## Twelve things that only broke in front of a test, not in code review

Dead lobby after the first run · silent auction alert on iPhone (no Vibration API) · blank phone
panel for 8 s per leg · server blocked on chain init · Explorer links never rendered · agent 16%
worse than none (wrong valuation) · scoreboard compared human-only to all-trains (announced the
dispatcher had *lost*) · K2 bid zero · K2 with reasoning off echoes the prompt (0 real decisions
in 123 calls) · 5-way junction overran the token budget (empty answer) · `.env` never read ·
a comment-only `.env` value disabled the chain.
