# Midnight Express — design system

**Direction:** a transit map on paper. Thick lines, white stations with a black ring, one colour
per train, and nothing glows. The references are Mini Metro's flat geometry, Vignelli's 1972
New York subway map and London Underground signage. Tokens live in `public/tokens.css`; the
board, the phone and the rules page all import it.

The first version was a dark art-deco departure board: near-black with a purple cast, gold
serif masthead, tracked uppercase labels, glowing pips, rounded cards with hairline borders. It
read as generated. Every one of those choices is the statistical default for "premium dark UI",
so the redesign starts from something true about the game instead: it is a map, it is read
across a room, and the only thing that should ever pulse is contested track.

## Typeface

**Cabin** (SIL Open Font License), self-hosted as one variable file (`/fonts/cabin.woff2`,
28 KB, weight 400–700) so the board works with no network. Cabin is a humanist sans in the
Johnston / Gill lineage — the letterforms of railway posters and Underground signage — and is
not the default of any framework. Its figures are proportional (a "1" is half the width of a
"0"), so every number that changes while you watch — the clock, the bid, the token count — is
rendered one fixed-width box per digit and does not wobble. Fallback stack: Gill Sans, Trebuchet
MS, system sans.

No letterspacing tricks. Labels are bold, sentence or title case; the only uppercase is the
small eyebrow label at `.04em`, the way a sign would set it.

## Two viewing distances, two type scales

The phone is read at ~40 cm. The board is read from ~3 m by someone who is not looking for
detail. Same palette, different scale — that is the whole reason `--fp-*` and `--fb-*` exist.

| Role | Phone | Board |
|---|---|---|
| eyebrow / label | 12px | 13px |
| body | 16px | 17px |
| large | 18px | 22px |
| display | 34px | 40px |
| hero / clock | 52px | 72px |
| bid / score | 96px | 104px |

## Palette and measured contrast

Ratios against `--paper` (#F3EFE6) unless noted.

| Token | Hex | Ratio | Use |
|---|---|---|---|
| `--ink` | #1B1B1B | **15.6** | text, station rings, train outlines, the PA strip |
| `--ink-2` | #5B574F | **6.4** | secondary text |
| `--ink-3` | #8E897E | 3.2 | **faint text and freight rows only** |
| `--red` | #E03A2F | **4.6** | contested track, held trains, the whole auction screen |
| `--green` | #12945F | **4.6** | home, the central dispatcher |
| `--agent` | #7A4BC8 | **5.6** | the rival's line on the scoreboard |
| `--paper-3` | #D9D3C5 | — | free track, rules |
| white on `--red` | #FFFFFF on #E03A2F | **4.6** | auction screen text and bid numeral |
| white on `--ink` | #FFFFFF on #1B1B1B | **15.6** | buttons, PA strip |

Everything carrying information passes WCAG AA for normal text. `--ink-3` is fenced to
decorative text and the freight rows, which are deliberately quiet.

**Train colours** (set in `server/sim.js`, assigned in boarding order): blue #0072BC, orange
#F28C00, green #00A651, purple #7A4BC8, magenta #E5007E, teal #00A3AD, brown #8A6D3B, indigo
#4C6EF5, ochre #C68A00, deep teal #00776B, olive #6B8E23, navy #2C3E7A. Saturated transit-line
colours that stay distinct on paper, none of them the signal red.

## The map (board canvas)

- **Track** is a 10px round-capped line: `--paper-3` when free, the occupying train's colour
  when held, `--red` with running white dashes when an auction is open. Nothing else animates.
- **Stations** are white discs with a 4px ink ring, radius 13; Oakland, where five tracks
  meet, gets radius 17 like an interchange. Names sit above in Cabin Bold 15px.
- **Trains** are pills rotated along their track. Players: 30×16 with a 2.5px ink outline and
  their name below in bold 13px with a paper-coloured halo so it stays legible over track.
  Freight and the rival: 20×11, no outline, 90% opacity, so humans dominate visually. Held
  trains swap the ink outline for red; arrived trains fade to 35% with a green outline.
- **Contested chips** are white plates with a red border pinned over the segment midpoint:
  red "Contested" then the two names in ink.
- **The PA** is a black signage strip bottom-left with white text and a speaker glyph.

## Components

**Touch targets** — `--touch-min: 56px`, never smaller. People tap this one-handed while being
shouted at.

| Component | Spec |
|---|---|
| Eyebrow label | 12/13px, 700, uppercase, `.04em`, `--ink-2` |
| Primary button | ink fill, white text, 2px ink border, 6px radius, 56px min height |
| Ghost button | transparent, 2px ink border, ink text |
| Card | white, 2px ink border, 6px radius |
| Choice row | white card, 56px; "Fastest" as an ink tag, "Occupied" as a red-outlined tag; selected = filled with **your** colour |
| Throttle | 84px white card; running = filled with your colour |
| Auction screen | the entire phone turns `--red`: white text, white 8px draining bar, 96px white numeral, white-outlined presets |
| Your colour | `--me`, set on the body at welcome: the 10px stripe at the top, the progress bar, the selected choice, the running throttle |
| Roster row | 14px colour square with ink border, name, tabular budget; 4px left edge red when held, green when home |

Borders are always 2px (`--line`). Radii are 4px or 6px — plates, not pills. No shadows, no
gradients, no glow.

**Focus rings are kept** (`:focus-visible`, 3px red) — judges may tab through on a laptop.
`prefers-reduced-motion` collapses all animation.

## Accessibility notes

- **iOS Safari has no Vibration API.** The auction alert therefore cannot depend on haptics.
  It fires a WebAudio chime *and* a vibrate *and* the full-screen red takeover. Audio is
  unlocked by the Board button tap, which is the required user gesture.
- Colour is never the sole signal: contested track is also striped and labelled, held trains
  also get an outline and a red roster edge, arrived trains also fade.
- Every input has a tap-only path. Nothing requires motion sensors.
