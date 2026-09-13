# Settlement on Solana

Two adapters implement the same three-method interface as `server/chain-stub.js`, and the
simulation cannot tell them apart. Both are fire-and-forget: nothing here is ever awaited by
a tick, and every failure degrades to `enabled = false`.

```js
async openAuction(runId, auction)          // contention opened -- nothing on-chain yet
async settleAuction(runId, auction, view)  // one transaction per settled auction
async finalizeRun(runId, summary)          // one receipt at run end -> { runId, sig, explorerUrl }
```

`server/index.js` picks the adapter from `CHAIN`: `memo`, `anchor`, or the stub.

## `solana-memo.js` — live on devnet

Each train gets an **ephemeral keypair** generated server-side when its player joins: no
wallet, no signup. Each settled auction is a transaction to the SPL Memo program carrying the
settlement (`{ run, auction, segment, winner, bid, paid, compensation }`), paid by a session
treasury and **co-signed by the trains in the auction**. The Memo program rejects any account
that did not sign, so the signers on Explorer are exactly the bidders, and a train's address
page lists exactly the auctions it was in. At run end a receipt with the scoreboard and crew
lands, co-signed by up to four humans.

- Treasury: `TREASURY_SECRET_KEY` (JSON byte array) or `.treasury.json`, generated if absent.
  The adapter asks the faucet once, then enables itself only when the balance confirms.
  `/health → chain` reports `enabled`, `reason`, `treasury`, `auctionsWritten`, `pending`.
- Each write is retried once after 1.2 s (fresh blockhash). The receipt falls back to
  treasury-only if it exceeds Solana's **1232-byte** transaction cap (each co-signer costs
  96 bytes; eight co-signers plus a 286-byte memo hit the cap exactly).
- Cost: ~0.000005 SOL per write. One devnet SOL is thousands of auctions.

Transactions from the hackathon's live runs (devnet, `Success · Finalized`):

- [Settled auction](https://explorer.solana.com/tx/3VWrVSESe3iQcS8Xtqr81Py2jmie9GbbZyvwD8VPu4RNNBa2FBPaSNkZzypg3bZERZWBPufabjbTNhpSD1sdeHeR?cluster=devnet) ·
  [first ever, after the signer fix](https://explorer.solana.com/tx/5oPtZiKc2iLEmownvFrKxEm1a1DY69sB55EBiaNDBfaEkX9M3kTRKLQwyJVKypydtny8FaqxXE3U2yenv4HJZZYv?cluster=devnet)
- [Run receipt](https://explorer.solana.com/tx/5JqPguEi5XMpTC3NrYiyqgLgDtuNbtXRHLHenzt4aA7QhnBcqiuqnG9rGzKgJFeKLjEP9XW8AmKAXnB9MBvY2AzW?cluster=devnet) ·
  [the one in the pitch video](https://explorer.solana.com/tx/3sggN8FjpShiVza33EU7sv2UxfxcYSepSPmhe8pmkxeWBvrZgTE1YQE9SS7E7CkPskV1xrskjyiHLQYKafJQSVPV?cluster=devnet)
- [Treasury](https://explorer.solana.com/address/48sFG5ydaaEpME7bdfyAUGw6Aj6KqVyyEf4CuGY5ngaD?cluster=devnet) (fee payer for all of the above)

## `anchor-adapter.js` + `midnight_express/` — compiles, client-verified, not deployed

The Anchor program keeps the whole crew's token balances in one `RunState` PDA and settles
each auction **on-chain** rather than merely recording it:

| Instruction | Where | What |
|---|---|---|
| `initialize_run(run_id, train_count, start_budget)` | devnet | create the PDA, every train gets the same allowance |
| `delegate_run(run_id)` | devnet | hand the PDA to a MagicBlock ephemeral rollup (sub-50 ms, zero fee) |
| `settle_auction(winner, price, losers[])` | rollup | second-price settlement: winner pays `price`, losers split it; delays counted |
| `commit_run` / `undelegate_run(run_id)` | rollup | push state to devnet / push and return ownership |

`#[ephemeral]` injects the undelegation callback; `#[delegate]` and `#[commit]` come from
`ephemeral-rollups-sdk`. The JS client derives the PDA (`["run", run_id_le_u64]`) from a
FNV-1a hash of the sim's run id, waits for delegation to land before the first settlement,
and drains pending writes before undelegating. All of that is exercised offline against the
IDL; on-network use needs the program deployed, which needs ~3.3 SOL of devnet rent that the
deploy wallet never got during the hackathon.

```bash
# toolchain used: rustc 1.98 · solana-cli 3.1 · anchor-cli 1.0.2
cd chain/midnight_express && anchor build           # -> target/deploy/midnight_express.so + target/idl/
./scripts/deploy-chain.sh                            # deploy to devnet once the wallet is funded
CHAIN=anchor npm start
```

Endpoints (from docs.magicblock.gg): base `https://api.devnet.solana.com`; ER
`https://devnet-us.magicblock.app` (ws `wss://devnet-us.magicblock.app/`); validator
`MUS3hc9TCw4cGC12vHNoYcCGzJG1txjgQLZWVoeNHNd`, pinned via `remainingAccounts` at delegation.
Three things that each cost an hour blind: pin the validator; ER transactions need the fee
payer signed by the **ephemeral** provider, not the base one; call `.exit()` on Anchor
accounts before state-modifying CPIs.
