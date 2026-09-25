FROM node:20-bookworm-slim AS deps

WORKDIR /app

COPY package*.json ./

RUN npm ci --omit=dev \
    && npm cache clean --force

FROM node:20-bookworm-slim AS runtime

ENV NODE_ENV=production

WORKDIR /app

COPY --from=deps --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node src ./src
COPY --chown=node:node scripts ./scripts
COPY --chown=node:node db ./db
COPY --chown=node:node public ./public
COPY --chown=node:node package*.json ./

USER node

EXPOSE 3000 9101

CMD ["node", "src/server.js"]