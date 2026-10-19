# Matchday Crew: TypeScript server (run natively by Node, no build step) and
# the Fluent UI web app (built by Vite in the first stage).

FROM node:22-alpine AS web
WORKDIR /build
COPY web/package.json web/package-lock.json ./web/
RUN npm --prefix web ci --no-audit --no-fund
COPY web ./web
COPY src/types.ts ./src/types.ts
RUN npm --prefix web run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production \
    PORT=8080

COPY package.json ./
COPY src ./src
COPY scripts ./scripts
COPY --from=web /build/web/dist ./web/dist
# Response cache: lines a model already wrote, served instantly and for free.
COPY --chown=node:node data/llm-cache ./data/llm-cache

USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s CMD wget -qO- http://127.0.0.1:8080/healthz >/dev/null || exit 1
CMD ["node", "scripts/serve.ts"]
