# Matchday Crew: second-screen app and agent crew. No npm dependencies.
FROM node:22-alpine

WORKDIR /app
ENV NODE_ENV=production \
    PORT=8080

COPY package.json ./
COPY src ./src
COPY scripts ./scripts
COPY public ./public
# Response cache: lines a model already wrote, served instantly and for free.
COPY --chown=node:node data/llm-cache ./data/llm-cache

USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s CMD wget -qO- http://127.0.0.1:8080/healthz >/dev/null || exit 1
CMD ["node", "scripts/serve.js"]
