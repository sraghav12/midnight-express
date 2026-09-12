# LANE D — Solana / MagicBlock

Implement `ChainAdapter` with the same three methods as `server/chain-stub.js`:

```js
async openAuction(runId, auction)          // optional: open the auction account
async settleAuction(runId, auction, view)  // submit ONE ER tx, return { ...view, erSig }
async finalizeRun(runId, summary)          // commit + undelegate, return { runId, sig, explorerUrl }
```

Then in `server/index.js` swap:
```js
import { ChainStub } from "./chain-stub.js";     // ->  import { MagicBlockAdapter } from "../chain/magicblock.js";
```
Nothing else in Lane A changes. That is the whole integration surface.

## Toolchain — INSTALL THIS FIRST, it is the long pole
```
Solana 3.1.9 · Rust 1.89.0 · Anchor 1.0.2 · Node 24.10.0
cargo add ephemeral-rollups-sdk --features anchor
```

## Devnet endpoints
```
Base layer     https://api.devnet.solana.com
Magic Router   https://devnet-router.magicblock.app      <- use from the frontend
ER (US)        https://devnet-us.magicblock.app    ws: wss://devnet-us.magicblock.app/
US validator   MUS3hc9TCw4cGC12vHNoYcCGzJG1txjgQLZWVoeNHNd
```

## Flow
`#[delegate]` on the accounts ctx -> `delegate()` moves the PDA to the delegation program
-> `#[ephemeral]` on the program injects the undelegate callback -> `commit()` syncs ER
state down -> `undelegate()` returns ownership.

## Three gotchas that each cost an hour if you hit them blind
1. Pin the validator address in `remainingAccounts` during delegation.
2. ER transactions need the fee payer signed by the **ephemeral** provider, not the base one.
3. Call `.exit()` on Anchor accounts before state-modifying CPIs.

## Start from
- `magicblock-labs/magicblock-engine-examples` -> `anchor-counter` (delegate/commit skeleton)
- `Allen-Saji/magic-uno` -> on-chain game with ER + native SOL wagers, i.e. almost exactly our auction

## State shape (keep balances INSIDE the delegated PDA -- do not use SPL tokens)
```rust
pub struct RunState {
    pub run_id: [u8; 16],
    pub trains: Vec<TrainSlot>,   // { pubkey, budget: u32, delay: u32 }
    pub auctions_settled: u32,
}
```

## G2 ABORT GATE — 2:30 AM
If the **stock** `anchor-counter` example is not delegating and committing on devnet ER by
2:30 AM, abort MagicBlock. Ladder: plain Anchor escrow -> if not up by 5:30 AM -> SPL Memo
receipts (~45 min). The Memo path still wins Best Use of Solana. A dead chain lane at 10 AM
does not.
