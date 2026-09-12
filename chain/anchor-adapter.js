/**
 * LANE D — the G2 path: Anchor program + MagicBlock Ephemeral Rollup.
 * Same three-method surface as chain-stub.js / solana-memo.js, plus an optional
 * startRun() hook the server calls at departure.
 *
 *   startRun      initialize_run on the BASE layer, then delegate_run -> the RunState
 *                 PDA now lives on the ER (sub-50ms, zero fee)
 *   settleAuction settle_auction sent to the ER: second-price settlement mutates the
 *                 crew's balances on-chain, one tx per auction
 *   finalizeRun   undelegate_run on the ER: commit final state back to devnet, return
 *                 ownership, hand the phones an Explorer link to the settled PDA
 *
 * Every call is fire-and-forget and every failure degrades to `enabled = false`.
 * Endpoints + validator pin are the ones from docs.magicblock.gg (see chain/README.md).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Connection, Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import anchorPkg from "@coral-xyz/anchor";
const { AnchorProvider, Program, Wallet, BN, BorshCoder } = anchorPkg;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const IDL_PATH = path.join(__dirname, "midnight_express", "target", "idl", "midnight_express.json");
const BASE_RPC = process.env.SOLANA_RPC || "https://api.devnet.solana.com";
const ER_RPC   = process.env.ER_RPC   || "https://devnet-us.magicblock.app";
const ER_WS    = process.env.ER_WS    || "wss://devnet-us.magicblock.app/";
const ER_VALIDATOR = new PublicKey(process.env.ER_VALIDATOR || "MUS3hc9TCw4cGC12vHNoYcCGzJG1txjgQLZWVoeNHNd");
const TREASURY_FILE = process.env.TREASURY_FILE || path.join(process.cwd(), ".treasury.json");
const CLUSTER = "devnet";

export const RUN_SEED = Buffer.from("run");
export const explorerAddr = (a) => `https://explorer.solana.com/address/${a}?cluster=${CLUSTER}`;
export const explorerTx = (s) => `https://explorer.solana.com/tx/${s}?cluster=${CLUSTER}`;

/** run_id (u64) -> little-endian 8 bytes, matching `run_id.to_le_bytes()` on-chain */
export function runIdBytes(runId) {
  const n = BigInt.asUintN(64, BigInt(runId));
  const b = Buffer.alloc(8); b.writeBigUInt64LE(n); return b;
}
export function runPda(programId, runId) {
  return PublicKey.findProgramAddressSync([RUN_SEED, runIdBytes(runId)], programId);
}
/** a stable u64 from the sim's string run id, so the PDA is reproducible from the run */
export function runIdFromString(s) {
  let h = 0xcbf29ce484222325n;
  for (const ch of String(s)) { h ^= BigInt(ch.charCodeAt(0)); h = BigInt.asUintN(64, h * 0x100000001b3n); }
  return h;
}

export function loadIdl() { return JSON.parse(fs.readFileSync(IDL_PATH, "utf8")); }

export class AnchorAdapter {
  constructor({ onReceipt = () => {}, onAuctionSig = () => {} } = {}) {
    this.label = "anchor-er";
    this.enabled = false;
    this.reason = "not initialised";
    this.onReceipt = onReceipt;
    this.onAuctionSig = onAuctionSig;
    this.sigs = [];
    this.pending = 0;
    this.run = null;          // { runId, runIdU64, pda, trainIndex: Map<trainId, u8> }
  }

  async init() {
    try {
      const idl = loadIdl();
      this.programId = new PublicKey(process.env.PROGRAM_ID || idl.address);
      const raw = fs.existsSync(TREASURY_FILE) ? JSON.parse(fs.readFileSync(TREASURY_FILE, "utf8")) : null;
      if (!raw) throw new Error("no treasury keypair");
      this.payer = Keypair.fromSecretKey(Uint8Array.from(raw));
      const wallet = new Wallet(this.payer);
      this.base = new AnchorProvider(new Connection(BASE_RPC, "confirmed"), wallet, { commitment: "confirmed" });
      this.er   = new AnchorProvider(new Connection(ER_RPC, { wsEndpoint: ER_WS, commitment: "confirmed" }), wallet, { commitment: "confirmed" });
      this.programBase = new Program(idl, this.base);
      this.programEr   = new Program(idl, this.er);

      // is the program actually deployed?
      const info = await this.base.connection.getAccountInfo(this.programId);
      if (!info?.executable) { this.reason = `program ${this.programId.toBase58()} not deployed on devnet`; console.warn(`[chain] anchor DISABLED — ${this.reason}`); return this; }
      const bal = await this.base.connection.getBalance(this.payer.publicKey);
      if (bal < 5_000_000) { this.reason = "treasury unfunded"; console.warn(`[chain] anchor DISABLED — ${this.reason}`); return this; }

      this.enabled = true; this.reason = "ok";
      console.log(`[chain] anchor+ER live — program ${this.programId.toBase58()} · ER ${ER_RPC}`);
    } catch (e) {
      this.enabled = false; this.reason = e.message;
      console.warn(`[chain] anchor DISABLED — ${e.message}`);
    }
    return this;
  }

  /** Departure: create the run on the base layer and hand it to the ER. Awaited by no one. */
  startRun(runId, trains, startBudget = 100) {
    if (!this.enabled) return;
    const runIdU64 = runIdFromString(runId);
    const [pda] = runPda(this.programId, runIdU64);
    const trainIndex = new Map(trains.map((t, i) => [t.id, i]));
    this.run = { runId, runIdU64, pda, trainIndex, delegated: false };
    this.pending++;
    (async () => {
      const bn = new BN(runIdU64.toString());
      await this.programBase.methods.initializeRun(bn, trains.length, startBudget)
        .accounts({ payer: this.payer.publicKey, run: pda, systemProgram: SystemProgram.programId })
        .rpc();
      await this.programBase.methods.delegateRun(bn)
        .accounts({ payer: this.payer.publicKey, run: pda, validator: ER_VALIDATOR })
        .remainingAccounts([{ pubkey: ER_VALIDATOR, isSigner: false, isWritable: false }])
        .rpc();
      this.run.delegated = true;
      console.log(`[chain] run ${runId} delegated to ER — ${explorerAddr(pda.toBase58())}`);
    })().catch((e) => console.warn(`[chain] startRun failed: ${e.message.slice(0, 120)}`))
      .finally(() => this.pending--);
  }

  async openAuction() { /* nothing until settlement */ }

  /** One ER transaction per settled auction. */
  settleAuction(runId, auction, view) {
    if (!this.enabled || !this.run || this.run.runId !== runId) return;
    const w = this.run.trainIndex.get(view.winner);
    const losers = Object.keys(view.compensation).map((id) => this.run.trainIndex.get(id)).filter((i) => i !== undefined);
    if (w === undefined || !losers.length) return;
    this.pending++;
    (async () => {
      // wait for delegation to land (first auction can beat it by a few hundred ms)
      for (let i = 0; i < 40 && !this.run.delegated; i++) await new Promise((r) => setTimeout(r, 250));
      if (!this.run.delegated) throw new Error("run never delegated");
      const sig = await this.programEr.methods.settleAuction(w, view.pricePaid, Buffer.from(losers))
        .accounts({ payer: this.payer.publicKey, run: this.run.pda })
        .rpc();
      this.sigs.push({ auctionId: view.auctionId, sig });
      // ER txs are visible on the ER explorer; the PDA state lands on devnet at commit
      this.onAuctionSig({ auctionId: view.auctionId, sig, explorerUrl: explorerAddr(this.run.pda.toBase58()) });
    })().catch((e) => console.warn(`[chain] settle ${view.auctionId} failed: ${e.message.slice(0, 120)}`))
      .finally(() => this.pending--);
  }

  /** Arrival: commit + undelegate. The devnet PDA now holds the final balances. */
  async finalizeRun(runId, summary) {
    if (!this.enabled || !this.run || this.run.runId !== runId) return null;
    try {
      for (let i = 0; i < 80 && this.pending > 0; i++) await new Promise((r) => setTimeout(r, 250));
      const bn = new BN(this.run.runIdU64.toString());
      const sig = await this.programEr.methods.undelegateRun(bn)
        .accounts({ payer: this.payer.publicKey, run: this.run.pda })
        .rpc();
      const receipt = { runId, sig, explorerUrl: explorerAddr(this.run.pda.toBase58()) };
      this.onReceipt(receipt);
      console.log(`[chain] run committed to devnet — ${receipt.explorerUrl}`);
      return receipt;
    } catch (e) {
      console.warn(`[chain] finalize failed: ${e.message.slice(0, 120)}`);
      return null;
    }
  }

  status() {
    return { label: this.label, enabled: this.enabled, reason: this.reason, cluster: CLUSTER,
      program: this.programId?.toBase58() ?? null, runPda: this.run?.pda.toBase58() ?? null,
      auctionsWritten: this.sigs.length, pending: this.pending };
  }
}
