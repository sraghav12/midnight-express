#!/usr/bin/env bash
# Start IFM K2 Horizon locally. No API key, no network, nothing to rate-limit.
# Stock Ollama CANNOT load this architecture -- it needs IFM's llama.cpp fork.
set -uo pipefail
FORK="${IFM_LLAMA:-/tmp/ifm-llama}"
BIN="$FORK/build/bin/llama-server"
PORT="${IFM_PORT:-8090}"

if [ ! -x "$BIN" ]; then
  echo "IFM llama.cpp fork not built at $FORK"
  echo "  git clone --depth 1 -b model/K2Horizon https://github.com/MBZUAI-IFM/llama.cpp.git $FORK"
  echo "  cmake -B $FORK/build -DGGML_METAL=ON -DLLAMA_CURL=OFF -DCMAKE_BUILD_TYPE=Release -S $FORK"
  echo "  cmake --build $FORK/build --target llama-server -j 8"
  exit 1
fi

GGUF="${IFM_GGUF:-$(ls -S "$HOME"/.ollama/models/blobs/sha256-* 2>/dev/null | head -1)}"
[ -z "${GGUF:-}" ] && { echo "no GGUF found. ollama pull hf.co/IFM/K2-Horizon-0.9B-GGUF"; exit 1; }

echo "model: $GGUF"
echo "starting K2 Horizon on :$PORT ..."
"$BIN" -m "$GGUF" --port "$PORT" -c 4096 -ngl 99 --jinja > /tmp/k2.log 2>&1 &
for i in $(seq 1 90); do
  curl -s --max-time 2 "http://localhost:$PORT/health" >/dev/null 2>&1 && { echo "  ready after ${i}s"; break; }
  sleep 1
done
echo
echo "  IFM K2 Horizon 0.9B serving at http://localhost:$PORT"
echo "  now start the game:   LLM_PROVIDER=ifm npm start"
