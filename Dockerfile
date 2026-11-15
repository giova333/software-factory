# syntax=docker/dockerfile:1
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

FROM node:22-bookworm-slim
RUN apt-get update \
 && apt-get install -y --no-install-recommends git ca-certificates ripgrep jq \
 && rm -rf /var/lib/apt/lists/*

# Harness CLIs, pinned. Codex and OpenCode join here in v1.1.
ARG CLAUDE_CODE_VERSION=2.1.325
RUN npm install -g @anthropic-ai/claude-code@${CLAUDE_CODE_VERSION} && npm cache clean --force

WORKDIR /app
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist

# Claude Code refuses --dangerously-skip-permissions as root, and nothing here needs root.
USER node
ENV HOME=/home/node
WORKDIR /home/node
ENTRYPOINT ["node", "/app/dist/cli.js"]
CMD ["--help"]
