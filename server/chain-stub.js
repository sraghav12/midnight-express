// Lane D swaps this file for chain/magicblock.js at G2.
// Lane A only ever calls these three methods -- keep the signatures identical.
import { auctionRequest, settlement, runReceipt } from "./contracts.js";

export class ChainStub {
  constructor({ onReceipt = () => {} } = {}) {
    this.onReceipt = onReceipt;
    this.pending = new Map();
    this.settled = [];
    this.label = "stub";
  }

  async openAuction(runId, auction) {
    this.pending.set(auction.id, auctionRequest(runId, auction));
  }

  async settleAuction(runId, auction, view) {
    // A real adapter submits one ER transaction here and fills in erSig.
    const s = settlement({
      auctionId: view.auctionId,
      winner: view.winner,
      pricePaid: view.pricePaid,
      compensation: view.compensation,
      erSig: `stub_${auction.id}`,
    });
    this.settled.push(s);
    return s;
  }

  async finalizeRun(runId, summary) {
    const receipt = runReceipt({
      runId,
      sig: `stub_${runId}`,
      explorerUrl: null,           // real adapter returns a devnet Explorer URL
    });
    this.onReceipt(receipt);
    return receipt;
  }
}
