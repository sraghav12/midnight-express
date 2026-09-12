#!/usr/bin/env bash
# Deploy the Midnight Express program to devnet and delegate a run to MagicBlock.
# Run this the moment the wallet has SOL. Everything before this point is done.
set -euo pipefail
export PATH="$HOME/.cargo/bin:$HOME/.local/share/solana/install/active_release/bin:$PATH"
cd "$(dirname "$0")/../chain/midnight_express"

echo "== toolchain =="
rustc --version; solana --version; anchor --version

echo "== wallet =="
if [ ! -f "$HOME/.config/solana/id.json" ]; then
  echo "no deploy wallet -- creating one"
  solana-keygen new --no-bip39-passphrase -o "$HOME/.config/solana/id.json"
fi
solana config set --url devnet >/dev/null
ADDR=$(solana address)
BAL=$(solana balance | awk '{print $1}')
echo "  deploy wallet $ADDR — $BAL SOL"

# measured: `solana rent` for the 309KB program = 3.14 SOL rent-exempt, plus fees
if awk "BEGIN{exit !($BAL < 3.3)}"; then
  echo
  echo "  NOT ENOUGH SOL. Deploying needs ~3.3 (3.14 rent for a 309KB program + fees)."
  echo "  Try:  solana airdrop 2"
  echo "  Or paste this at https://faucet.solana.com (devnet):"
  echo "      $ADDR"
  exit 1
fi

echo "== build =="
anchor build

echo "== deploy =="
anchor deploy --provider.cluster devnet
PROGRAM=$(grep -oE '"[A-Za-z0-9]{32,}"' Anchor.toml | head -1 | tr -d '"')
echo
echo "  program:  $PROGRAM"
echo "  explorer: https://explorer.solana.com/address/$PROGRAM?cluster=devnet"
echo
echo "NEXT: point the server at it —"
echo "  CHAIN=anchor PROGRAM_ID=$PROGRAM npm start"
