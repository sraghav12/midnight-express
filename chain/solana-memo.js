/**
 * LANE D — floor implementation. No Rust, no Anchor, no MagicBlock.
 *
 * Every settled auction and every finished run is written to Solana devnet as a
 * Memo transaction signed by a session treasury. Each train gets an EPHEMERAL
 * keypair generated server-side and passed as a read-only signer-less account on
 * its own auctions, so a player's transactions are attributable to their train
 * without anyone installing a wallet.
 *
 * This is the fallback the plan's G2 ladder drops to. It is a real, verifiable
 * Solana integration on its own; the Anchor/ER adapter replaces it wholesale by
 * implementing the same three methods (see chain/README.md).
 *
 * HARD RULE: nothing here may ever block or break the game. Every call is
 * fire-and-forget, every failure degrades to `enabled = false`.
 */
import fs from "node:fs";
import path from "node:path";
import {
  Connection, Keypair, PublicKey, Transaction,
  TransactionInstruction, SystemProgram, LAMPORTS_PER_SOL,
} from "@solana/web3.js";

const MEMO_PROGRAM = new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");
const CLUSTER = process.env.SOLANA_CLUSTER || "devnet";
const RPC = process.env.SOLANA_RPC || "https://api.devnet.solana.com";
const TREASURY_FILE = process.env.TREASURY_FILE || path.join(process.cwd(), ".treasury.json");
const MIN_BALANCE = 0.05 * LAMPORTS_PER_SOL;

export const explorerTx = (sig) =>
  `https://explorer.solana.com/tx/${sig}?cluster=${CLUSTER}`;
export const explorerAddr = (addr) =>
  `https://explorer.solana.com/address/${addr}?cluster=${CLUSTER}`;

export class SolanaMemoAdapter {
  constructor({ onReceipt = () => {}, onAuctionSig = () => {} } = {}) {
    this.label = "solana-memo";
    this.enabled = false;
    this.reason = "not initialised";
    this.onReceipt = onReceipt;
    this.onAuctionSig = onAuctionSig;
    this.conn = new Connection(RPC, "confirmed");
    this.treasury = null;
    this.trainKeys = new Map();   // trainId -> Keypair
    this.sigs = [];               // { auctionId, sig }
    this.pending = 0;
  }

  // ---------------------------------------------------------------- setup
  loadTreasury() {
    if (process.env.TREASURY_SECRET_KEY) {
      try {
        const raw = JSON.parse(process.env.TREASURY_SECRET_KEY);
        return Keypair.fromSecretKey(Uint8Array.from(raw));
      } catch (e) {
        console.warn(`[chain] TREASURY_SECRET_KEY is not a JSON byte array (${e.message.slice(0, 40)}) -- using ${TREASURY_FILE}`);
      }
    }
    if (fs.existsSync(TREASURY_FILE)) {
      const raw = JSON.parse(fs.readFileSync(TREASURY_FILE, "utf8"));
      return Keypair.fromSecretKey(Uint8Array.from(raw));
    }
    const kp = Keypair.generate();
    fs.writeFileSync(TREASURY_FILE, JSON.stringify([...kp.secretKey]));
    return kp;
  }

  async init() {
    try {
      this.treasury = this.loadTreasury();
      let bal = await this.conn.getBalance(this.treasury.publicKey);

      if (bal < MIN_BALANCE) {
        console.log(`[chain] treasury ${this.treasury.publicKey.toBase58()} low (${bal / LAMPORTS_PER_SOL} SOL), requesting airdrop…`);
        try {
          const sig = await this.conn.requestAirdrop(this.treasury.publicKey, LAMPORTS_PER_SOL);
          await this.conn.confirmTransaction(sig, "confirmed");
          bal = await this.conn.getBalance(this.treasury.publicKey);
        } catch (e) {
          // devnet faucets are aggressively rate limited -- this is expected, not fatal
          console.warn(`[chain] airdrop refused (${e.message.slice(0, 80)})`);
        }
      }

      if (bal < 1_000_000) {
        this.enabled = false;
        this.reason = `treasury unfunded (${bal} lamports). Fund ${this.treasury.publicKey.toBase58()} at faucet.solana.com`;
        console.warn(`[chain] DISABLED — ${this.reason}`);
        return this;
      }

      this.enabled = true;
      this.reason = "ok";
      console.log(`[chain] live on ${CLUSTER} — treasury ${this.treasury.publicKey.toBase58()} (${(bal / LAMPORTS_PER_SOL).toFixed(3)} SOL)`);
      console.log(`[chain] ${explorerAddr(this.treasury.publicKey.toBase58())}`);
    } catch (e) {
      this.enabled = false;
      this.reason = e.message;
      console.warn(`[chain] DISABLED — ${e.message}`);
    }
    return this;
  }

  /** Every train gets a throwaway identity. No wallet, no signup, no install. */
  keyFor(trainId) {
    if (!this.trainKeys.has(trainId)) this.trainKeys.set(trainId, Keypair.generate());
    return this.trainKeys.get(trainId);
  }
  addressFor(trainId) { return this.keyFor(trainId).publicKey.toBase58(); }

  // ---------------------------------------------------------------- writes
  /**
   * The Memo program REQUIRES every account passed to it to be a signer -- a
   * non-signer account fails simulation ("Error processing Instruction 0").
   * So the trains' ephemeral keypairs co-sign: the treasury pays, each train
   * signs its own auction. That is also the honest version of the story --
   * on Explorer, a player's address shows transactions their train signed.
   */
  async #memo(text, signerKeypairs = []) {
    const uniq = [...new Map(signerKeypairs.map((k) => [k.publicKey.toBase58(), k])).values()];
    const ix = new TransactionInstruction({
      keys: uniq.map((k) => ({ pubkey: k.publicKey, isSigner: true, isWritable: false })),
      programId: MEMO_PROGRAM,
      data: Buffer.from(text, "utf8"),
    });
    const tx = new Transaction().add(ix);
    return this.conn.sendTransaction(tx, [this.treasury, ...uniq], { skipPreflight: false });
  }

  async openAuction() { /* nothing on-chain until it settles */ }

  /**
   * One transaction per settled auction. Fire-and-forget: the sim never awaits this.
   * The winner's and losers' ephemeral pubkeys ride along as read-only accounts, so
   * each player's Explorer address page lists exactly the auctions they were in.
   */
  settleAuction(runId, auction, view) {
    if (!this.enabled) return;
    const memo = JSON.stringify({
      p: "midnight-express/v1", k: "auction", run: runId,
      a: view.auctionId, seg: view.segment,
      win: view.winner, bid: view.winningBid, paid: view.pricePaid,
      comp: view.compensation,
    });
    const keys = [
      this.keyFor(view.winner),
      ...Object.keys(view.compensation).map((id) => this.keyFor(id)),
    ];
    this.pending++;
    this.#memo(memo, keys)
      .then((sig) => {
        this.sigs.push({ auctionId: view.auctionId, sig });
        this.onAuctionSig({ auctionId: view.auctionId, sig, explorerUrl: explorerTx(sig) });
      })
      .catch((e) => console.warn(`[chain] auction ${view.auctionId} write failed: ${e.message.slice(0, 90)}${e.logs ? " | " + e.logs.slice(-2).join(" / ") : ""}`))
      .finally(() => this.pending--);
  }

  /** One final receipt carrying the scoreboard and the crew roster. */
  async finalizeRun(runId, summary) {
    if (!this.enabled) return null;
    const memo = JSON.stringify({
      p: "midnight-express/v1", k: "run", run: runId,
      ticks: summary.ticks,
      swarm: summary.scoreboard.humanSwarmDelay,
      agent: summary.scoreboard.agentDelay,
      base: summary.baselineDelay ?? null,
      crew: summary.trains.filter((t) => !t.isAgent).map((t) => ({
        n: t.name, d: t.delayTicks, w: t.auctionsWon, l: t.auctionsLost, b: t.budget,
      })),
      auctions: this.sigs.length,
    });
    try {
      const sig = await this.#memo(memo, summary.trains.filter((t) => !t.isAgent).slice(0, 8).map((t) => this.keyFor(t.id)));
      const receipt = { runId, sig, explorerUrl: explorerTx(sig) };
      this.onReceipt(receipt);
      console.log(`[chain] run receipt ${explorerTx(sig)}`);
      return receipt;
    } catch (e) {
      console.warn(`[chain] run receipt failed: ${e.message.slice(0, 90)}`);
      return null;
    }
  }

  status() {
    return {
      label: this.label, enabled: this.enabled, reason: this.reason, cluster: CLUSTER,
      treasury: this.treasury?.publicKey.toBase58() ?? null,
      auctionsWritten: this.sigs.length, pending: this.pending,
    };
  }
}
