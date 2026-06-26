# syntax=docker/dockerfile:1

# ---- Builder stage: install all deps and compile TypeScript ----
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
# --ignore-scripts avoids running husky's "prepare" hook (no git in image)
RUN npm ci --ignore-scripts
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# ---- Runtime stage: production deps only + compiled output ----
FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY --from=builder /app/dist ./dist
# Prebuilt WASM artifact (built in CI before docker build)
COPY rust-agent/plugin/target/wasm32-unknown-unknown/release/agent_plugin.wasm \
     ./rust-agent/plugin/target/wasm32-unknown-unknown/release/agent_plugin.wasm

# Run as the non-root user that ships with the node image
USER node
EXPOSE 3000
CMD ["node", "dist/server.js"]
