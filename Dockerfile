FROM node:22-bookworm-slim

ENV NODE_ENV=production
WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates poppler-utils tini \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci --include=dev --ignore-scripts \
    && npm cache clean --force

COPY --chown=node:node . .
RUN mkdir -p /data /run/trigger-auth /app/.trigger \
    && chown node:node /data /run/trigger-auth /app/.trigger

USER node
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["npm", "run", "bot"]
