# Midnight Express — design system

**Direction:** art-deco departure board. Brass on deep ink, 1920s night train.
Tokens live in `public/tokens.css`; both surfaces import it.

> Built from first principles — the octo BM25 design databases are not installed on this
> machine (`~/.claude-octopus/plugin/vendors/` missing), so this is the documented fallback.

## Two viewing distances, two type scales

The phone is read at ~40cm. The board is read from ~3m across an expo hall by a judge who is
*not* looking for detail. Same palette, different scale — that is the whole reason `--fp-*`
and `--fb-*` exist.

| Role | Phone | Board |
|---|---|---|
| eyebrow / label | 11px | 13px |
| body | 15px | 16px |
| large | 17px | 22px |
| display | 30px | 44px |
| hero | 46px | 74px |
| bid / score | 66px | 96px |

**No webfonts, deliberately.** Venue wifi is a liability and a font that fails to load at
judging time is a self-inflicted wound. The deco character comes from uppercase + heavy
letter-spacing (`.22em` on labels), a serif stack for display numerals, tabular figures,
and hairline rules with a brass accent segment — none of which require a download.

## Palette + measured contrast

All ratios measured against `--ink-900` (#08070C).

| Token | Hex | Ratio | Use |
|---|---|---|---|
| `--paper` | #F4EDDC | **17.2** | primary text |
| `--paper-dim` | #B0A791 | **8.4** | secondary text |
| `--paper-faint` | #6E6757 | 3.6 | **large/decorative text and borders only** |
| `--brass-400` | #F0C462 | **12.2** | headings, key numerals |
| `--brass-500` | #E0A93F | **9.5** | primary action, station pips |
| `--brass-700` | #8A6A2C | 4.0 | **borders and large text only** |
| `--signal-red` | #FF5470 | **6.5** | contested track |
| `--signal-green` | #25D9A0 | **11.0** | arrived |
| `--signal-amber` | #FFB24C | **11.2** | held |
| `--agent` | #B98CFF | **7.9** | the Grok train |
| ink on brass button | #241A06 on #E0A93F | **8.1** | primary button |

Everything carrying real information passes WCAG AA for normal text. The two that don't are
fenced to borders and large decorative text.

## Components

**Touch targets** — `--touch-min: 56px`, never smaller. People are tapping this while being
shouted at, one-handed, sometimes while shaking the phone.

| Component | Spec |
|---|---|
| Eyebrow label | 11/13px, `.22em` tracking, uppercase, `--paper-dim`, 600 |
| Primary button | brass-500 fill, ink text, 56px min-height, 12px radius |
| Ghost button | transparent, 1px `--ink-600` border, `--paper-dim` text |
| Choice row | 56px min-height, `--ink-700`, brass border when *fastest*, green when selected |
| Throttle | 84px, inset gradient, brightens on hold |
| Auction overlay | full-bleed red radial, `slam` entry, 66px bid numeral, 5s draining bar |
| Deco rule | 1px `--ink-600` with a 56×3px brass segment at the left |
| Station pip | 11px ring in brass-700, 3.5px brass-500 core, label 26px above |

**Focus rings are kept** (`:focus-visible`, 2px brass) — judges may tab through on a laptop.
`prefers-reduced-motion` collapses all animation.

## Board-specific

- Every rail draws twice: a dark 11px "sleeper bed" under a 4px rail. Cheap depth, reads at 3m.
- Contested segments pulse red at ~6.7Hz with a floating **CONTESTED** chip naming both trains,
  positioned at the segment midpoint. This is the single most important thing on the screen.
- Trains lerp toward their target at `0.22`/frame. The server broadcasts at 10Hz; without
  interpolation, slow trains look stepped.
- Player trains are 13px with a name label; agent trains are 8px at 50% opacity so humans
  visually dominate. Arrived trains gain a green ring.

## Accessibility notes

- **iOS Safari has no Vibration API.** The auction alert therefore cannot depend on haptics.
  It fires a WebAudio chime *and* a vibrate *and* a full-screen visual takeover. Audio is
  unlocked by the Board button tap, which is the required user gesture.
- Every input has a tap-only path. Nothing requires motion sensors.
- Colour is never the sole signal: contested track also gets a text chip, arrived trains
  also get a ring, held trains also get a label.
