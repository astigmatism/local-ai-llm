FROM node:24-bookworm-slim

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8000 \
    OLLAMA_BASE_URL=http://ollama:11434 \
    CONFIG_PATH=/app/config/local-ai-llm.json \
    NVIDIA_DRIVER_CAPABILITIES=compute,utility

USER root

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
    bash \
    ca-certificates \
    tini \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./

RUN npm ci --omit=dev --ignore-scripts \
    && npm cache clean --force

COPY src ./src
COPY public ./public
COPY config ./config
COPY README.md ./README.md
COPY tsconfig.json ./tsconfig.json

RUN mkdir -p /app/config /cache \
    && chown -R node:node /app /cache

USER node

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=5 \
    CMD node -e "fetch('http://127.0.0.1:8000/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["npm", "start"]
