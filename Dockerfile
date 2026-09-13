# Midnight Express -- game server + board + phone client in one container.
# No model and no chain by default: the rival plays on its heuristic and every
# auction settles off-chain. Point LLM_PROVIDER / CHAIN at real backends via env.
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=8080
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY server ./server
COPY chain/solana-memo.js chain/anchor-adapter.js ./chain/
COPY public ./public
COPY scripts/loadtest.js scripts/bench.js ./scripts/
EXPOSE 8080
HEALTHCHECK --interval=15s --timeout=3s --start-period=5s CMD wget -qO- http://127.0.0.1:8080/health >/dev/null || exit 1
CMD ["node", "server/index.js"]
