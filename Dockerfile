# syntax=docker/dockerfile:1.7

# ============================================================================
# builder — full toolchain: installs deps + compiles native modules + builds
# shared types and frontend assets. Never deployed; image stays heavy.
# ============================================================================
FROM node:20-alpine AS builder

# Native-module toolchain (better-sqlite3, node-pty build from source via node-gyp).
RUN apk add --no-cache python3 python3-dev py3-pip make g++ linux-headers git bash
RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app

# Manifest layer first — cache key for the dep install below.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/backend/package.json ./packages/backend/
COPY packages/frontend/package.json ./packages/frontend/

# --frozen-lockfile so CI and prod resolve identical versions; fails loud if the
# lockfile drifts from package.json.
RUN pnpm install --frozen-lockfile

# Sources last — edits here don't bust the deps layer.
COPY packages/shared ./packages/shared
COPY packages/backend ./packages/backend
COPY packages/frontend ./packages/frontend

# Shared types compile before frontend (frontend imports from shared).
# Backend stays as .ts source — runtime uses tsx (see CMD below).
RUN pnpm --filter @claude-code-webui/shared build && \
    pnpm --filter @claude-code-webui/frontend build


# ============================================================================
# runtime — slim image, no compiler toolchain. Native .node binaries are
# already built in `builder` and copied over via node_modules.
# ============================================================================
FROM node:20-alpine AS runtime

LABEL org.opencontainers.image.title="Claude Code WebUI"
LABEL org.opencontainers.image.description="Web-based interface for Claude Code CLI"
LABEL org.opencontainers.image.source="https://github.com/zwaetschge/claude-code-webui"
LABEL org.opencontainers.image.licenses="MIT"
LABEL org.opencontainers.image.vendor="Claude Code WebUI"

# Runtime OS tooling only — git for repo ops, docker-cli/compose for self-rebuild,
# curl+openssh for CLI installers and remote auth flows. No python/g++ here.
RUN apk add --no-cache git bash docker-cli docker-cli-compose curl openssh-client unzip imagemagick

# User-writable npm prefix: the `node` user must be able to upgrade the AI CLIs
# at runtime (see services/cli-updates.ts). Mounted volume overlays this path.
ENV NPM_CONFIG_PREFIX=/home/node/.npm-global
ENV PATH=/home/node/.local/bin:/home/node/.npm-global/bin:$PATH
RUN mkdir -p /home/node/.npm-global && \
    npm install -g @anthropic-ai/claude-code @openai/codex opencode-ai && \
    rm -f /home/node/.npm-global/lib/node_modules/opencode-ai/bin/.opencode

WORKDIR /app

# Hoist artifacts from builder. Backend keeps its TS source because tsx runs it
# directly; shared ships its compiled dist (consumed by backend + frontend via
# the `@claude-code-webui/shared` workspace link); frontend ships only the
# Vite-built static bundle.
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages/shared/node_modules ./packages/shared/node_modules
COPY --from=builder /app/packages/backend/node_modules ./packages/backend/node_modules
COPY --from=builder /app/packages/frontend/node_modules ./packages/frontend/node_modules
COPY --from=builder /app/package.json /app/pnpm-workspace.yaml /app/tsconfig.base.json ./
COPY --from=builder /app/packages/shared/package.json ./packages/shared/package.json
COPY --from=builder /app/packages/shared/dist ./packages/shared/dist
COPY --from=builder /app/packages/backend/package.json ./packages/backend/package.json
COPY --from=builder /app/packages/backend/tsconfig.json ./packages/backend/tsconfig.json
COPY --from=builder /app/packages/backend/src ./packages/backend/src
COPY --from=builder /app/packages/frontend/package.json ./packages/frontend/package.json
COPY --from=builder /app/packages/frontend/dist ./packages/frontend/dist

# Helper scripts (mcp-comfyui, etc.) — no build step, copied as-is.
COPY scripts ./scripts

# Volume-friendly runtime dirs, owned by node:node (uid 1000).
# OpenCode uses XDG paths (~/.config/opencode for config, ~/.local/share/opencode
# for auth). Symlink both into the single /home/node/.opencode mount so one
# volume persists config + credentials across rebuilds.
RUN mkdir -p /home/node/.claude /home/node/.codex \
             /home/node/.opencode/config /home/node/.opencode/share \
             /home/node/.config /home/node/.local/share && \
    ln -sfn /home/node/.opencode/config /home/node/.config/opencode && \
    ln -sfn /home/node/.opencode/share /home/node/.local/share/opencode && \
    chown -R node:node /app /home/node

EXPOSE 3001
ENV NODE_ENV=production
ENV HOME=/home/node

USER node

# tsx runs TypeScript directly so strict-mode compile errors never surface in
# prod. Minor cold-start cost; equivalent steady-state performance.
CMD ["npx", "tsx", "packages/backend/src/index.ts"]
