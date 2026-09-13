# Findings

What building and then hardening this taught us, in the order it mattered. Numbers marked
*measured* come from `npm run bench` (deterministic, reproducible to the tick) or from
`/health` counters on live runs during the hackathon.

## 1. A 0.9B reasoning model is a fine player -- for the right kind of decision

The rival's route is chosen by IFM's K2 Horizon 0.9B running on a laptop (no key, no
network), or by any Ollama / OpenAI-compatible model.

- **Reasoning off, it does not decide.** At ~0.15 s per call the model *echoed the prompt*.
  In one live run, 123 of 123 "decisions" were rejected by the parser; the "K2-driven rival"
  was 100 % heuristic and only the `/health` counter revealed it. Reasoning on (~2 s) it picked
  the shortest unoccupied route 4 of 4 times. **Count decisions that actually landed, and
  put the number where you will see it.**
- **Token budget scales with the branching factor.** A two-way junction reasons in ~220
  tokens; the five-way Oakland junction needs ~500. A cut-off returns *empty* content, which
  the first parser read as "invalid". Budget is 700.
- **Discrete choice, yes. Open-ended number, no.** Asked for "an integer" bid, the model
  sometimes answered 0 and gave the track away; with reasoning it needed ~400 tokens and 3 s.
  Bids therefore stay on the calibrated rule. `LLM_BIDS=1` lets the model *move* the bid
  inside `[0.6×, 1.5× + 2]` of the rule, never abandon it.
- **Parse for the decision, not the format.** Models think out loud even when told not to;
  taking the *last* valid code in the answer is robust to prose, `<think>` blocks and
  restated options. `test/agent.test.js` pins this against realistic transcripts.
- **Gate the calls, never await them.** One call per junction, never overlapping, applied
  when it lands. The 20 Hz tick does not know the model exists. Everything has a timeout and
  a heuristic underneath, so the game is identical whether the model is brilliant or dead.

## 2. What "true value" is in a second-price auction here

Vickrey's result -- bid your true value, because you pay the *other* bid -- only helps if you
know the value. The first agent priced the *detour delta* (how much longer the alternative
route was). It bid ~8 against opponents bidding 0–40 and lost nearly everything: 16 % *more*
delay than an idle train. The thing being bought is the **wait avoided**: a loser does not
detour, it sits at the signal until the winner clears the segment. Pricing that, scaled by
how much journey is left (`urgency = wait / (wait + remaining)`), and multiplied by an
aggression factor set by sweep, produced the rival that ships.

*Measured* -- room of 10, mixed fixed-style opponents, scarcity 3, subject rotated through
every boarding slot (`npm run bench`):

| Subject policy | Mean delay (s) | vs default | Tokens spent / earned |
|---|---:|---:|---:|
| default (idle player) | 24.7 | — | 0 / 1 |
| keen (bids 30 %) | 17.7 | −28 % | 16 / 20 |
| sharp (bids 50 %) | 13.8 | −44 % | 27 / 11 |
| all-in (bids 100 %) | 12.3 | −50 % | 37 / 4 |
| rival: routing only | 22.4 | −9 % | 0 / 2 |
| rival: true-value bid only | 12.7 | −49 % | 29 / 10 |
| **rival (routing + true value)** | **11.5** | **−53 %** | 29 / 10 |

Three things the ablation says that the hackathon claim ("48 % less delay") did not:

- **Bidding dominates in crowded rooms; routing dominates in sparse ones.** At 16 trains,
  routing alone is worth 1 %; at 6 trains it is worth 79 % on its own, because there is
  free track to route *onto*. The rival combines both and is best or tied-best at every size.
- **All-in is nearly optimal, and that is a property of the mechanism, not the player.**
  Second price means an aggressive bidder pays what the *others* bid, and with 100 tokens
  and ~8 auctions per run the budget almost never binds. All-in wins the track and pays 28 %
  more than true value for a delay 7 % worse. If you want bidding to be a real skill, the
  lever is budget scarcity (lower `START_BUDGET`, more auctions per run), not the rule.
- **At venue pacing the true-value rule saturates.** With `SCARCITY=7` the wait avoided is
  large enough that `budget × urgency × 3` exceeds the budget on most auctions -- the rule
  *is* all-in there (same 37 tokens, same 13.8 s). `--sweep` shows delay flat from
  `AGENT_AGGRO=4` upward. 3.0 is kept because it is the smallest value that is never worse.

## 3. Compare like with like, or the scoreboard lies in your favour

The first scoreboard compared *human-only* delay in the live run to *all-train* delay in the
centralized replay. On a real run it read "0.5× the delay of one dispatcher" -- i.e. the
room beat perfect central control, which is impossible and would have been noticed by any
judge who thought about it for three seconds. Every train self-interested versus every
train under one dispatcher gives the honest number: **2.7–2.8×** at venue pacing, 4–5× at
scarcity 3 (*measured*, `npm run bench` prints it for each room). The gap is the price of
everyone acting in their own interest, and it grows as track gets tighter.

The baseline is a **centralized greedy dispatcher with full information**, not an optimal
multi-agent path-finding solution. We say that rather than "optimal"; CBS is the upgrade.

## 4. Contention has to be engineered

With four players the network is empty and the mechanism is invisible; with forty it
gridlocks. Two knobs make the game the same at any room size: `SCARCITY` stretches every
segment (2.5 gave 9-second journeys that felt like nothing; 7 gives ~24 s), and
`MIN_TRAFFIC` adds heuristic freight so one human still meets ~7 auctions. The network shape
does the rest: three bridges and a degree-5 junction between where trains start and where
they must go.

## 5. The bug the hackathon did not find

Post-hackathon, reading `dispatchWaiting` with fresh eyes: a train *held in an auction* was
still allowed to request a different segment if the player re-steered during the eight-second
window. It entered that segment; then the auction settled and either (a) it won and
`enterSegment` overwrote its position, leaving the first segment "occupied" by a ghost, or
(b) it lost and was set to `at_node` while physically on a segment, which nothing would ever
release. Either way one segment was dead for the rest of the run and, in the reproduction,
the train never arrived. A real player tapping a different track mid-auction would have hit
this. The fix locks bidders until settlement (their re-steer is honoured *after*), makes
`enterSegment` release anything the train still holds, and adds an **occupancy invariant**
checked after every tick in the tests. A second latent issue: the central policy tie-broke on
id *strings*, and base-36 ids compare out of creation order after the 36th id, so two
identical replays could disagree. Now: stable sort on delay only, and a determinism test.

## 6. Writing to a chain from a game loop

- **The Memo program requires every account passed to it to sign.** The first design passed
  each train's ephemeral pubkey as a read-only account for attribution and every write failed
  with `MissingRequiredSignature`. The fix -- the server holds the keypairs, so the trains
  **co-sign** their own auctions -- is also the better story: Explorer shows *Signed by* the
  exact bidders.
- **1232 bytes.** Eight co-signers plus the crew JSON hit Solana's transaction cap *exactly*,
  so every per-auction link appeared and the closing run receipt never did. Each co-signer
  costs 96 bytes. Now up to four human co-signers, with a treasury-only fallback.
- **Fire-and-forget, self-disabling.** `await chain.init()` once kept the server from
  listening. Nothing chain-side may ever be awaited by the sim; the adapter starts disabled
  and flips on when the treasury balance confirms. Devnet faucets rate-limit hard; funding was
  the single most common thing blocked on a human.

## 7. "The key is set" means nothing until the consuming process prints that it sees it

Three separate outages traced to configuration that existed but was invisible: `.env` was
never read; then it was read but *after* the modules that needed it had already evaluated
their constants (ES imports run before the importer's body -- hence `server/env.js` must be
the first import); then a template line `KEY=   # comment` was loaded as the literal comment
and the chain adapter `JSON.parse`d it and disabled itself. `/health` now reports the brain,
the voice provider and the chain state, and the pre-flight checked it rather than trusting
HTTP 200. The parser has tests.

## 8. Small physical facts that decide whether a demo works

- iOS Safari has no Vibration API; the auction alert is a WebAudio chime plus a full-screen
  takeover, unlocked by the user's first tap.
- At eight seconds per segment a phone that only offers choices *at* a junction is blank
  most of the time. Letting players pre-select the next track while in transit is what made
  the controller feel alive.
- `localhost` on a phone is the phone. The boot banner prints the LAN URL; the QR encodes
  `PUBLIC_URL` when set.
- Campus wifi wildcard-blocked `*.trycloudflare.com` at the DNS level; a judge scanning the
  QR on wifi got nothing. The fix was a real host with a real hostname. A sleeping laptop
  kills a reverse tunnel; `caffeinate` starts with the tunnel.
- Five seconds was too short for a sealed bid with real thumbs. Eight is the shipped value.
