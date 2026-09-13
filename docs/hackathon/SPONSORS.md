# Sponsor evidence — Midnight Express

Everything below is verifiable without running anything. Live instance: https://155-138-204-133.sslip.io/play
(`/health` on the same host reports which model is driving, whether the chain is enabled, and how many
model decisions and on-chain writes the current run has made.)

## Solana — Best Use of Solana

Every contested track is settled on **devnet** as a Memo transaction **co-signed by the trains in the
auction** (the Memo program rejects any account that did not sign — so the signers on-chain are exactly
the players who bid). A run receipt lands at arrival. Players get their Explorer links pushed to their
phones live; no wallet, no signup — keypairs are minted on join.

Transactions from tonight's live runs (all devnet, all `Success · Finalized`):

- Settled auction: https://explorer.solana.com/tx/3VWrVSESe3iQcS8Xtqr81Py2jmie9GbbZyvwD8VPu4RNNBa2FBPaSNkZzypg3bZERZWBPufabjbTNhpSD1sdeHeR?cluster=devnet
- Settled auction (first ever, after the signer fix): https://explorer.solana.com/tx/5oPtZiKc2iLEmownvFrKxEm1a1DY69sB55EBiaNDBfaEkX9M3kTRKLQwyJVKypydtny8FaqxXE3U2yenv4HJZZYv?cluster=devnet
- Run receipt: https://explorer.solana.com/tx/5JqPguEi5XMpTC3NrYiyqgLgDtuNbtXRHLHenzt4aA7QhnBcqiuqnG9rGzKgJFeKLjEP9XW8AmKAXnB9MBvY2AzW?cluster=devnet
- Run receipt (the one in the pitch video): https://explorer.solana.com/tx/3sggN8FjpShiVza33EU7sv2UxfxcYSepSPmhe8pmkxeWBvrZgTE1YQE9SS7E7CkPskV1xrskjyiHLQYKafJQSVPV?cluster=devnet
- Treasury (fee payer for all of the above): https://explorer.solana.com/address/48sFG5ydaaEpME7bdfyAUGw6Aj6KqVyyEf4CuGY5ngaD?cluster=devnet

Code: `chain/solana-memo.js`. The Anchor program (`chain/midnight_express/programs/…/lib.rs`) implements the
same settlement with **MagicBlock ephemeral-rollup delegation** (`initialize_run → delegate_run →
settle_auction on the ER → undelegate_run`); it compiles and the client (`chain/anchor-adapter.js`) is
verified against the IDL, but it is **not deployed** — the deploy wallet is 1.3 SOL short of the 3.14 SOL
rent. We say so rather than claim it.

Two bugs worth knowing we hit: the Memo program's signer requirement (`MissingRequiredSignature` — fixed by
having trains co-sign, which is also the better story), and Solana's 1232-byte transaction cap (8 co-signers
+ crew JSON = exactly 1232; now ≤4 co-signers with a treasury-only fallback).

## IFM — K2 Horizon

**K2-Horizon-0.9B** (`IFM/K2-Horizon-0.9B-GGUF`) runs **locally** under IFM's own llama.cpp fork
(`MBZUAI-IFM/llama.cpp`, branch `model/K2Horizon`) — stock Ollama cannot load the `k2-horizon` architecture,
so we built the fork. No API key, no network.

Its job: **it chooses the rival train's route.** At each junction it is given the options (distance to
destination, which tracks are occupied) and picks, with reasoning ON, once per junction (~2–4 s). Every
decision is logged; `/health → agent.ok / agent.calls` counts them (2/2 in every verified run).

Findings we measured, not assumed:
- Reasoning **off**: ~0.15 s but the 0.9B model **echoes the prompt** — 123 calls, 0 valid decisions in one
  run. Reasoning **on**: picks the shortest unoccupied route 4/4.
- A 5-way junction needs ~500 reasoning tokens; at 220 the answer is truncated to empty. Budget is 700.
- Bids stay on a calibrated true-value rule: asked for "an integer", the model sometimes answers 0.

Code: `server/llm.js`, `server/agent.js`, `scripts/start-ifm.sh`.

## Google — Best Use of Gemini API

`gemini-flash-lite-latest` via the OpenAI-compatible endpoint is the **dispatcher's voice**: every
non-urgent PA line the game emits (settlements, stalls, arrivals) is rephrased by Gemini in the persona
of a 1920s railway dispatcher (~0.6 s) before it is shown and spoken. Urgent lines (auction open) go out
verbatim so timing never waits on a network call. Sample, from a live run, given the rule-based input
*"Track contested at Oakland. Priya against K2. 8 seconds."*: **"Train seven bypassed Oakland; freight
rights sold to highest bidder."** Note: the `gemini-2.5-*` model names return 404 for new keys; the model
is env-configurable. Code: `server/dispatcher.js`, `server/llm.js`.

## xAI — Make it Legendary with SpaceXAI

- **Grok 4.3** writes the two-sentence **end-of-run report** from the real scoreboard (total delay vs. the
  central dispatcher, best and most-delayed human by name). Sample from the pitch video's run: *"The
  central dispatcher was faster than everyone routing themselves. Marcus won no auctions."* We benchmarked
  grok-4.6 (reasons past a 20 s window), grok-4.3 (~4 s, best prose), and grok-4.20-non-reasoning (~1 s).
- **Grok Imagine 2.0** (`grok-imagine-image-2.0`) generated the dispatch board's art-deco backdrop
  (1280×720, layered at 16% behind the live rail map).

Code: `server/dispatcher.js` (`RECAP_PROVIDER=xai`), `public/screen.html`.

## Vultr — Best Use of Vultr

A Vultr instance (`vhf-1c-1gb`, Atlanta, Ubuntu 26.04, IP `155.138.204.133`) is the public **HTTPS front
door**: Caddy + Let's Encrypt, reverse-proxying to the game server over an SSH reverse tunnel. Deliberate
topology: the simulation and the local IFM model stay on the laptop; Vultr provides the stable public
hostname — because the campus network wildcard-blocks throwaway tunnel hostnames (`*.trycloudflare.com`
→ NXDOMAIN), which would have left judges on wifi with a dead QR. One-command bring-up:
`scripts/vultr-setup.sh` (box) + `scripts/vultr-tunnel.sh` (laptop); `scripts/preflight.sh` checks all 14
moving parts. Live: https://155-138-204-133.sslip.io/play

## Not claimed

ElevenLabs (voice is browser speech), Auth0, MongoDB Atlas, Sandia — not used. We did not tick them.
