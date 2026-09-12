// FROZEN CONTRACTS -- locked 2026-09-11 22:45 EDT.
// Every lane codes against these shapes. DO NOT CHANGE without telling all four lanes.
//
// Lane A (sim) <-> Lane B (clients) over WebSocket.
// Lane A <-> Lane D (chain) via the ChainAdapter interface at the bottom.

export const PROTOCOL_VERSION = 1;

// ---------------------------------------------------------------------------
// A -> B  (server to phone / screen).  Every frame is {t: <type>, ...}
// ---------------------------------------------------------------------------
//
// t:"welcome"  -> { trainId, name, color, origin, destination, budget, deadlineTick, network }
// t:"state"    -> { tick, phase, trains:[TrainView], segments:{segId: trainId|null}, auctions:[AuctionView] }
// t:"auction"  -> AuctionView            (fired to bidders only; phone buzzes)
// t:"settled"  -> SettlementView
// t:"arrived"  -> { trainId, tick, delayTicks }
// t:"runEnd"   -> { runId, scoreboard, replay, explorerUrl }
// t:"error"    -> { message }

// ---------------------------------------------------------------------------
// B -> A  (phone to server)
// ---------------------------------------------------------------------------
//
// t:"join"     -> { name? }
// t:"steer"    -> { toNode }             pick the next node at a junction
// t:"throttle" -> { value }              0..1
// t:"bid"      -> { auctionId, amount }  integer tokens, <= budget

// ---------------------------------------------------------------------------
// A -> D  on each contested segment
// ---------------------------------------------------------------------------
export function auctionRequest(runId, auction) {
  return {
    runId,
    auctionId: auction.id,
    segment: auction.segmentId,
    bidders: auction.bidders.map((b) => ({ train: b.trainId, budget: b.budget })),
    closesAt: auction.closesAt,
  };
}

// ---------------------------------------------------------------------------
// D -> A  on settle
// ---------------------------------------------------------------------------
export function settlement({ auctionId, winner, pricePaid, compensation, erSig }) {
  return { auctionId, winner, pricePaid, compensation, erSig: erSig ?? null };
}

// ---------------------------------------------------------------------------
// D -> A  once at arrival
// ---------------------------------------------------------------------------
export function runReceipt({ runId, sig, explorerUrl }) {
  return { runId, sig, explorerUrl };
}

/**
 * Lane D implements this. Lane A only ever sees these three methods.
 * server/chain-stub.js is the off-chain stub; swap for chain/magicblock.js at G2.
 */
export const ChainAdapterShape = {
  //   async openAuction(auctionRequest) -> void
  //   async settleAuction(auction, bids) -> settlement
  //   async finalizeRun(runSummary)      -> runReceipt
};
