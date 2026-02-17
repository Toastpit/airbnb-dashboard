FROM node:20-bookworm-slim

WORKDIR /app

# Build deps für better-sqlite3
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

# deps zuerst (caching)
COPY server/package*.json ./server/
RUN cd server && npm ci --omit=dev

# dann code
COPY server ./server
COPY public ./public

ENV NODE_ENV=production
EXPOSE 3010
CMD ["node", "server/server.js"]
