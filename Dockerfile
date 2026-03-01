FROM node:20-alpine

# Metadata labels for Docker Hub
LABEL org.opencontainers.image.title="Claude Code WebUI"
LABEL org.opencontainers.image.description="Web-based interface for Claude Code CLI"
LABEL org.opencontainers.image.source="https://github.com/zwaetschge/claude-code-webui"
LABEL org.opencontainers.image.licenses="MIT"
LABEL org.opencontainers.image.vendor="Claude Code WebUI"

# Install pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

# Install build dependencies for native modules (node-pty), git, and Docker CLI + Compose
RUN apk add --no-cache python3 python3-dev py3-pip make g++ linux-headers git bash unzip docker-cli docker-cli-compose curl openssh-client

# Install global npm packages into user-writable prefixes
ENV NPM_CONFIG_PREFIX=/home/node/.npm-global
ENV CLI_PROVIDER_GLM_PREFIX=/home/node/.npm-glm
ENV PATH=/home/node/.local/bin:/home/node/.npm-global/bin:/home/node/.npm-glm/bin:$PATH
RUN mkdir -p /home/node/.npm-global /home/node/.npm-glm

# Install AI CLI tools globally (Claude, Codex, Gemini)
RUN npm install -g @anthropic-ai/claude-code @openai/codex @google/gemini-cli

# Install a separate Claude Code CLI instance for GLM
RUN npm install -g --prefix /home/node/.npm-glm @anthropic-ai/claude-code

# Install Mistral Vibe CLI (Python-based)
RUN pip install --break-system-packages mistral-vibe

# Install Kimi CLI (Python-based, requires uv)
ENV UV_INSTALL_DIR=/home/node/.local/bin
RUN curl -LsSf https://astral.sh/uv/install.sh | sh && \
    HOME=/home/node /home/node/.local/bin/uv tool install --python 3.13 kimi-cli

# The node:alpine image already has a 'node' user (uid 1000)

WORKDIR /app

# Copy package files
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/backend/package.json ./packages/backend/
COPY packages/frontend/package.json ./packages/frontend/

# Install dependencies (not using frozen-lockfile for self-hosted flexibility)
RUN pnpm install

# Copy source code
COPY . .

# Build shared types
RUN pnpm --filter shared build

# Build frontend
RUN pnpm --filter frontend build

# Create directories and set permissions for node user
RUN mkdir -p /home/node/.claude /home/node/.glm /home/node/.vibe /home/node/.kimi /home/node/.npm-global /home/node/.npm-glm && \
    chown -R node:node /app /home/node

# Expose ports
EXPOSE 3001

# Set environment
ENV NODE_ENV=production
ENV HOME=/home/node

# Switch to non-root user
USER node

# Start the server using tsx (handles ES module resolution)
CMD ["npx", "tsx", "packages/backend/src/index.ts"]
