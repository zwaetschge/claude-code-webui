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
RUN pnpm --filter @plum-code-webui/shared build && \
    pnpm --filter @plum-code-webui/frontend build


# ============================================================================
# runtime — slim image, no compiler toolchain. Native .node binaries are
# already built in `builder` and copied over via node_modules.
# ============================================================================
FROM node:20-alpine AS runtime

LABEL org.opencontainers.image.title="Plum Code WebUI"
LABEL org.opencontainers.image.description="Web-based interface for Codex, OpenCode, Mistral Vibe, and Claude Code CLIs"
LABEL org.opencontainers.image.source="https://github.com/zwaetschge/plum-code-webui"
LABEL org.opencontainers.image.licenses="MIT"
LABEL org.opencontainers.image.vendor="Plum Code WebUI"

# Runtime OS tooling. gcompat + libstdc++ + libgcc let glibc-linked binaries
# (codex's Rust binary, opencode's Go binary) run on Alpine's musl libc —
# without these, the npm postinstall hits SIGILL when verifying the binary.
# python3 + pipx are added for mistral-vibe (Python CLI installed via pipx).
# blender-headless powers the built-in Blender MCP for background asset generation.
RUN apk add --no-cache git bash docker-cli docker-cli-compose curl openssh-client unzip imagemagick gcompat libstdc++ libgcc python3 py3-pip pipx ripgrep py3-httpx jq coreutils tzdata chromium chromium-chromedriver nss freetype harfbuzz font-noto font-noto-cjk ttf-freefont xvfb blender-headless

# User-writable npm prefix: the `node` user must be able to upgrade the AI CLIs
# at runtime (see services/cli-updates.ts). Mounted volume overlays this path.
ENV NPM_CONFIG_PREFIX=/home/node/.npm-global
ENV PATH=/home/node/.local/bin:/home/node/.npm-global/bin:$PATH
ENV CHROME_BIN=/usr/local/bin/plum-chromium
ENV CHROMIUM_BIN=/usr/local/bin/plum-chromium
ENV CHROMIUM_PATH=/usr/local/bin/plum-chromium
ENV BROWSER=/usr/local/bin/plum-chromium
ENV PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/local/bin/plum-chromium
ENV PUPPETEER_EXECUTABLE_PATH=/usr/local/bin/plum-chromium
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
ENV PUPPETEER_SKIP_DOWNLOAD=1
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=1
ENV BLENDER_BIN=blender-headless
ENV GODOT_BIN=
ENV XDG_RUNTIME_DIR=/tmp/runtime-node
# Install the legacy Claude CLI strictly; the other CLIs are best-effort because
# codex + opencode native postinstall checks can hit SIGILL under some BuildKit/QEMU setups.
# Install them best-effort so the
# image builds even when the emulator can't exec them — they can be installed
# at runtime via the /api/cli-updates endpoint or by re-running the npm install
# inside the running container.
RUN mkdir -p /home/node/.npm-global && \
    npm install -g @anthropic-ai/claude-code && \
    (npm install -g @openai/codex@latest || echo "WARN: codex install failed at build time — install via /api/cli-updates at runtime") && \
    (npm install -g opencode-ai && rm -f /home/node/.npm-global/lib/node_modules/opencode-ai/bin/.opencode \
        || echo "WARN: opencode-ai install failed at build time — install via /api/cli-updates at runtime")

# Mistral Vibe: Python-based CLI, installed via pipx into the node user's home.
# Pre-create pipx dirs and install as `node` so the venv is owned by the runtime user.
# Best-effort: if PyPI is unreachable during build, ops can install via /api/cli-updates.
ENV PIPX_HOME=/home/node/.local/pipx
ENV PIPX_BIN_DIR=/home/node/.local/bin
RUN mkdir -p /home/node/.local/pipx /home/node/.local/bin /home/node/.vibe && \
    chown -R node:node /home/node/.local /home/node/.vibe && \
    su node -s /bin/sh -c "pipx install mistral-vibe" \
        || echo "WARN: mistral-vibe install failed at build time — install via /api/cli-updates at runtime"

WORKDIR /app

# Hoist artifacts from builder. Backend keeps its TS source because tsx runs it
# directly; shared ships its compiled dist (consumed by backend + frontend via
# the `@plum-code-webui/shared` workspace link); frontend ships only the
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

RUN install -m 0755 ./scripts/chromium-webui.sh /usr/local/bin/plum-chromium && \
    ln -sfn /usr/local/bin/plum-chromium /usr/local/bin/chromium && \
    ln -sfn /usr/local/bin/plum-chromium /usr/local/bin/chromium-browser && \
    ln -sfn /usr/local/bin/plum-chromium /usr/local/bin/google-chrome && \
    ln -sfn /usr/local/bin/plum-chromium /usr/local/bin/google-chrome-stable

# Volume-friendly runtime dirs, owned by node:node (uid 1000).
# OpenCode uses XDG paths (~/.config/opencode for config, ~/.local/share/opencode
# for auth). Symlink both into the single /home/node/.opencode mount so one
# volume persists config + credentials across rebuilds.
#
# Codex CLI's skills system looks under ~/.agents/skills/<name>/SKILL.md (not
# ~/.claude/skills/). Symlink so the same skill packs work for both providers
# without duplication. Same idea for AGENTS.md / CLAUDE.md (Codex reads AGENTS.md).
RUN mkdir -p /home/node/.claude /home/node/.codex /home/node/.vibe \
             /home/node/.opencode/config /home/node/.opencode/share \
             /home/node/.config /home/node/.local/share /home/node/.agents \
             /tmp/runtime-node && \
    ln -sfn /home/node/.opencode/config /home/node/.config/opencode && \
    ln -sfn /home/node/.opencode/share /home/node/.local/share/opencode && \
    ln -sfn /home/node/.claude/skills /home/node/.agents/skills && \
    chown -R node:node /app /home/node /tmp/runtime-node

EXPOSE 3001
ENV NODE_ENV=production
ENV HOME=/home/node
ENV TZ=Etc/UTC

USER node

# tsx runs TypeScript directly so strict-mode compile errors never surface in
# prod. Minor cold-start cost; equivalent steady-state performance.
CMD ["npx", "tsx", "packages/backend/src/index.ts"]
