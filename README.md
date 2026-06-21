# Plum Code WebUI

Self-hosted web interface for Codex, OpenCode, Mistral Vibe, and Claude Code CLIs. Plum Code WebUI gives each provider the same browser workspace: streaming chat, tool approvals, file and git panes, provider analytics, shared agents/skills/plugins, preview tooling, and built-in MCP servers inside one Docker deployment.

> **Default provider: Codex.** Anthropic is restricting `claude -p` / introducing a credit system, so Codex is now the primary CLI. Claude stays available as a legacy option.

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-blue.svg)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-18.3-blue.svg)](https://react.dev/)

# Screenshots

## Desktop

![Sessions dashboard](docs/screenshots/plum-dashboard.png)
_Sessions dashboard - create or resume projects, filter by provider, and start Codex/OpenCode/Vibe/Claude sessions from one place._

![Codex chat](docs/screenshots/plum-chat-codex.png)
_Codex chat - streaming output, tool execution, provider/model controls, YOLO mode, usage limits, and mobile-aware layout._

![Analytics page](docs/screenshots/plum-analytics.png)
_Analytics - unified token volume, API-equivalent spend, cache efficiency, provider mix, pricing health, and per-model breakdown._

![Extensions settings](docs/screenshots/plum-settings-extensions.png)
_Extensions - manage MCP servers, shared agents, skills, plugins, and provider-specific auth/config from the settings UI._

## Mobile

<img src="docs/screenshots/plum-mobile-chat.png" alt="Mobile chat view" width="320" />

_Responsive chat with the same provider-aware UI on phone-sized viewports._

## Features

### Chat Interface

- Provider-aware streaming responses over WebSocket
- Multi-session management with history, starring, groups, provider badges, and running-state indicators
- Per-session provider, model, reasoning, service-tier, web-search, and permission-mode controls
- Image attachments plus inline image generation/editing through ComfyUI MCP
- LaTeX/Math rendering with KaTeX
- Interactive choice prompts and permission approvals
- Context & token popover with live progress bar
- Usage limit bar for providers that expose quotas
- Todo and subagent lifecycle rendering when the active CLI emits them
- Shared `/agents`, `/skills`, `/subagents`, and slash-command discovery

### DevTools Integration

- **Context Popover**: Inline progress bar showing context window usage (green -> yellow -> red), click to see full token breakdown (input/output/cache read/cache write), cost, and model
- **Tool-Log Panel**: Full tool execution timeline with filter buttons (All, Read, Write, Bash, Web, Agent), duration tracking per tool, live timers for running tools, expandable input/output details
- **Compaction Boundary Cards**: Visual separators in chat when context is compacted, with expandable summary text
- **Preview Tooling**: Start local dev servers, inspect output, and keep process logs redacted before they are returned to the UI/API

### Multi-Provider Support

- **Codex** (OpenAI) - **default provider**, per-turn `codex exec` process model with auto-respawn, chunk-level streaming, transcript-prefix resume, and model discovery from `~/.codex/models_cache.json`
- **OpenCode** - server-backed HTTP/SSE provider routing for GLM (`z-ai/glm-*`), Kimi, Anthropic/OpenAI/Gemini routes, and 75+ other LLMs
- **Mistral Vibe** - Mistral Medium 3.5 / Devstral coding models, argv-based prompt execution, per-session `VIBE_HOME`, and `--continue` resume
- **Claude Code** (Anthropic) - legacy persistent stream-json provider
- Per-session provider selection; switching providers restarts the underlying CLI cleanly
- Dedicated auth routes: `/auth/codex`, `/auth/opencode`, `/auth/vibe`, `/auth/claude`
- Independent CLI instances + persisted auth per provider (`~/.codex`, `~/.local/share/opencode`, `~/.vibe`, `~/.claude`)
- Admin/helper LLM calls, such as commit message generation, route through the same Codex-first provider preference

### Analytics

- Unified `usage_history` ledger for all providers
- Token volume, request count, cache efficiency, pricing coverage, and API-equivalent spend
- Per-model pricing with explicit unpriced-model handling
- Provider grouping shared between backend analytics and frontend charts
- Codex usage limits from the ChatGPT Codex usage endpoint when OAuth tokens are available

### File Management

- File Tree Browser with lazy loading and git status
- Monaco Code Editor with syntax highlighting
- Create, edit, delete, and rename files
- Three view modes: Simple, Compact, Detailed

### Git Integration

- Full Git Panel (staging, commits, diffs, history)
- Visual branch management (create, publish, delete)
- Commit history with diff viewer
- AI-powered commit message generation
- Pull/Fetch with remote status (ahead/behind)

### GitHub Integration

- Create new repositories
- Clone repositories (with repo browser)
- Push to GitHub with remote management
- Token-authenticated operations

### Custom Commands

- Built-in commands: `/help`, `/clear`, `/model`, `/status`, `/cost`, `/compact`
- User commands from `~/.claude/commands/*.md`
- Project commands from `{project}/.claude/commands/*.md`
- Autocomplete dropdown when typing `/`

### Project Management

- Project Auto-Discovery from `~/.claude/projects`
- Working directory navigation
- Session starring and filtering
- PTY Reconnect with 30-minute buffer

### MCP Servers (built-in)

- **comfyui-images** - text-to-image and image-edit tools backed by ComfyUI workflows, rendered inline in chat
- **android-builder** - ~25 tools for building, installing, launching, and testing Android apps via the `android-app-creator` backend (project lifecycle, build, ADB, emulator, on-device testing)
- **godot** - create, inspect, validate, script, and export Godot projects through a local MCP bridge
- **blender** - create, inspect, export, and render 3D assets through Blender Python in background mode
- Settings can also list and test global MCP servers from the provider config, such as audio or project-specific bridges

### Admin

- Admin pages: user list, role management, audit log
- `AUTH_ALLOWED_EMAILS` env-var allowlist (gates both OAuth and basic-auth)
- First-login admin bootstrap via `SEED_ADMIN_EMAIL`

### Extensions

- Shared agents from `~/.claude/agents`
- Shared skills from `~/.claude/skills`, including design-system skill packs
- Plugin management for user and marketplace plugins
- Codex plugin browser/install flow for OpenAI-curated plugins
- Auto-sync of external skill packs and provider links for OpenCode/Vibe where supported

### Mobile Support

- Progressive Web App (PWA)
- Bottom tab navigation
- Swipe gestures for panel navigation
- Responsive design
- Native Android client (`packages/android`)

### Settings

- Tabbed settings interface
- Theme configuration
- Per-provider API key / OAuth management (Codex, OpenCode, Mistral Vibe, Claude, GitHub, Google)
- MCP Server management with connection testing
- Mistral API key storage encrypted with `ENCRYPTION_KEY`
- ComfyUI URL testing and persistence
- Memory viewer for session context

## Tech Stack

### Backend

- **Express.js** - HTTP server
- **Socket.IO** - Real-time communication
- **SQLite** (better-sqlite3) - Database
- **node-pty** - interactive CLI process management
- **simple-git** - Git operations
- **@octokit/rest** - GitHub API

### Frontend

- **React 18** - UI framework
- **Vite** - Build tool with code splitting
- **Radix UI** - Accessible components
- **Tailwind CSS** - Styling
- **Zustand** - State management
- **TanStack Query** - Data fetching
- **Monaco Editor** - Code editing
- **KaTeX** - Math rendering

### Shared

- **TypeScript** - Type safety across all packages

## Installation

### Quick start (Docker)

```bash
git clone https://github.com/zwaetschge/plum-code-webui.git
cd plum-code-webui
./scripts/install.sh
```

The installer walks you through:

1. **Prereq check** - docker, docker compose plugin, openssl, daemon connectivity.
2. **Interactive `.env`** - public URL, port, allowlisted login emails, host paths for data/config/workspace. Auto-generates `SESSION_SECRET` + `JWT_SECRET`.
3. **`docker compose build` + `up -d`** - first run takes a few minutes.
4. **Health wait** - polls `/health` (or the container's healthcheck) for up to 2 min.
5. **Optional Codex login** - runs `codex login` inside the container because Codex is the default provider. Other providers can be authenticated later from Settings or their dedicated `/auth/<provider>` route. Can be skipped with `--skip-login`.

Re-run any time to reconfigure (existing `.env` values are preserved unless you pass `--reset`). Non-interactive mode (`--non-interactive`) takes all defaults and is useful for CI bootstraps.

**Requirements:** Docker 24+, Docker Compose plugin, openssl. The container ships its own Node plus the `codex`, `opencode`, `vibe`, and `claude` CLIs.

### Site-specific deployment (Traefik, Unraid, etc.)

The repo's `docker-compose.yml` is intentionally portable: no Traefik labels, no absolute paths, no external networks. Site-specific overrides go into `docker-compose.override.yml` (gitignored), which Compose auto-merges. A copy-paste starting point lives at `docker-compose.override.yml.example` and shows how to add Traefik labels, absolute host paths (for example `/mnt/user/appdata/...` on Unraid), `group_add` for the docker socket GID, and the repair-bot rebuild sidecar.

### Manual Docker (no installer)

```bash
cp .env.example .env       # then edit: SESSION_SECRET, JWT_SECRET, AUTH_ALLOWED_EMAILS, FRONTEND_URL
docker compose up -d --build
```

Access the WebUI at the `FRONTEND_URL` you configured (default `http://localhost:4545`).

### Development setup (no Docker)

```bash
pnpm install                # workspace deps
pnpm dev                    # backend (3006) + frontend (5173) in parallel
# or:
./scripts/start-webui.sh    # generates ephemeral secrets, kills stale PIDs, tails logs
```

Prerequisites: Node 20+, pnpm 9+, and whichever provider CLIs you want to run locally (`codex`, `opencode`, `vibe`, `claude`).

### Production build (no Docker)

```bash
pnpm build
pnpm start
```

### Rebuild / redeploy

For deployed Docker instances, use the repair-bot sidecar instead of recreating the main container from inside itself:

```bash
bash scripts/plum-rebuild.sh
```

The script writes `data/rebuild-trigger.json`, waits for `repair-bot` to rebuild and recreate the main container from outside, then runs a sanity check against `http://localhost:${WEBUI_PORT:-4545}/`. Use `--no-cache`, `--no-wait`, or `--timeout=N` when needed.

## Configuration

### Environment Variables

Full schema in `packages/backend/src/config.ts` (zod-validated, fails fast on startup). `scripts/install.sh` writes the common values into `.env`; the rest are optional deployment or provider overrides.

| Variable                                                                           | Description                                                                                                                                                 | Required    |
| ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| `SESSION_SECRET` / `JWT_SECRET`                                                    | Express session and JWT signing secrets (min 32 chars each). Installer auto-generates.                                                                      | Yes         |
| `AUTH_ALLOWED_EMAILS`                                                              | Comma-separated email allowlist enforced for both OAuth and basic-auth. Empty = no allowlist, only safe behind a private network or SSO proxy.              | Recommended |
| `SEED_ADMIN_EMAIL`                                                                 | First user with this email gets `role=admin` on first login. Defaults to the first allowlist entry when unset.                                              | No          |
| `FRONTEND_URL` / `CORS_ALLOWED_ORIGINS` / `TRUST_PROXY`                            | Public URL, extra CORS origins, and Express proxy trust. `TRUST_PROXY=true` is unsafe without a trusted reverse proxy in front.                             | No          |
| `WEBUI_PORT` / `WEBUI_SHM_SIZE` / `TZ`                                             | Host port (default `4545`), Chromium shared memory (default `1gb`), and timezone.                                                                           | No          |
| `DATA_DIR` / `CONFIG_DIR` / `WORKSPACE_DIR` / `ALLOWED_BASE_PATHS`                 | Host paths bind-mounted to persistent data, provider homes, and workspaces.                                                                                 | No          |
| `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` / `GITHUB_CALLBACK_URL`                | Optional GitHub OAuth. Callback: `${FRONTEND_URL}/auth/github/callback`.                                                                                    | No          |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `GOOGLE_CALLBACK_URL`                | Optional Google OAuth. Callback: `${FRONTEND_URL}/auth/google/callback`.                                                                                    | No          |
| `ENCRYPTION_KEY`                                                                   | Enables encrypted storage for provider API keys, including the Mistral key managed in Settings.                                                             | Recommended |
| `CLI_PROVIDER_<PROVIDER>_MODELS`                                                   | Override model menus for `CODEX`, `OPENCODE`, `VIBE`, or `CLAUDE`; empty means auto-discover or use provider fallback.                                      | No          |
| `CLI_PROVIDER_<PROVIDER>_DEFAULT_MODEL`                                            | Override defaults such as Codex `gpt-5.5`, OpenCode `z-ai/glm-5.1`, Vibe `mistral-vibe-cli-latest`, or Claude `sonnet`.                                     | No          |
| `CLI_PROVIDER_OPENCODE_DEFAULT_AGENT` / `CLI_PROVIDER_OPENCODE_STYLE_PROMPT`       | OpenCode WebUI primary agent and Codex-like communication style. Defaults to `build`; set style prompt to `0` or `false` to disable the injected reminder.  | No          |
| `MISTRAL_API_KEY`                                                                  | Enables Mistral Vibe when no user-specific key is stored in Settings.                                                                                       | No          |
| `ADMIN_LLM_PROVIDER`                                                               | Pin admin/helper calls to `codex`, `opencode`, `vibe`, or `claude`. Default preference is Codex first.                                                      | No          |
| `CODEX_WEBUI_SANDBOX_MODE` / `CODEX_WEBUI_APPROVAL_POLICY`                         | Codex Docker defaults. The image defaults to `danger-full-access` / `never` because Codex's Landlock `workspace-write` sandbox is unreliable inside Docker. | No          |
| `CODEX_USAGE_URL` / `CODEX_USER_AGENT`                                             | Override the ChatGPT Codex usage endpoint or User-Agent used for `/api/usage/limits?provider=codex`.                                                        | No          |
| `COMFYUI_URL`                                                                      | Fallback ComfyUI base URL. Settings can override it without restart.                                                                                        | No          |
| `OPENAI_API_KEY`                                                                   | Exposes OpenAI API billing to CLI sessions and `scripts/openai-image.sh` when no key is stored in app settings.                                             | No          |
| `GODOT_BIN` / `GODOT_TIMEOUT_MS`                                                   | Optional Godot 4 binary and timeout for the built-in Godot MCP. Scaffolding works without it; validation/export require it.                                 | No          |
| `BLENDER_BIN` / `BLENDER_TIMEOUT_MS`                                               | Blender binary and timeout for the built-in Blender MCP. The runtime image defaults to `blender-headless`.                                                  | No          |
| `PREVIEW_HOSTNAME`                                                                 | Optional hostname used by the dev-server preview proxy.                                                                                                     | No          |
| `CHROME_BIN` / `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` / `PUPPETEER_EXECUTABLE_PATH` | System Chromium wrapper exposed to CLI sessions (default: `/usr/local/bin/plum-chromium`).                                                                  | No          |

### CLI Integration

The backend spawns each provider as a child process and bridges its stream over Socket.IO:

```bash
# Codex - default, single-shot per turn; WebUI respawns after turn.completed
codex exec --json --skip-git-repo-check --cd /workspace/my-project ...

# OpenCode - server-backed model routing for GLM, Kimi, Anthropic, OpenAI, etc.
opencode run --format json --model z-ai/glm-5.1 ...

# Mistral Vibe - argv prompt, isolated VIBE_HOME per WebUI session
vibe --output streaming --trust --workdir /workspace/my-project -p "..."

# Claude Code - legacy persistent stream-json provider
claude --print --verbose --output-format stream-json --input-format stream-json \
       --include-partial-messages --dangerously-skip-permissions
```

All CLIs ship inside the container; their auth/state directories (`~/.codex`, `~/.opencode`, `~/.vibe`, `~/.claude`) survive rebuilds via the `${CONFIG_DIR}` bind mount. OpenCode is symlinked into its expected `~/.config/opencode` and `~/.local/share/opencode` paths. The runtime image also includes system Chromium, Chromedriver, fonts, and Xvfb; sessions inherit `CHROME_BIN=/usr/local/bin/plum-chromium` plus Playwright/Puppeteer executable-path env vars for headless browser checks.

## Project Structure

```
packages/
├── backend/              # Express + Socket.IO server
│   ├── src/
│   │   ├── routes/       # REST API endpoints (~30 modules)
│   │   ├── services/
│   │   │   └── claude/   # Legacy folder name; owns Codex / OpenCode / Vibe / Claude lifecycle
│   │   ├── auth/         # Passport (GitHub, Google) + basic-auth + allowlist
│   │   ├── middleware/   # CSP, rate limiting, error handling
│   │   └── db/           # SQLite (better-sqlite3) + migrations
├── frontend/             # React 18 + Vite SPA
│   ├── src/
│   │   ├── components/
│   │   │   ├── chat/     # Messages, tools, compaction cards, subagents
│   │   │   ├── session/  # Controls, tool log
│   │   │   └── ui/       # Radix-based primitives
│   │   ├── pages/        # Sessions, admin, settings
│   │   ├── stores/       # Zustand stores
│   │   ├── services/     # API + Socket.IO client
│   │   └── hooks/
├── shared/               # Shared TypeScript types
├── desktop/              # Desktop shell wrapper
├── android/              # Native Android client
└── scripts/
    └── mcp-servers/      # comfyui.mjs, android-builder.mjs, godot.mjs, blender.mjs (stdio MCP)
```

## API Endpoints

### Sessions

- `GET /api/sessions` - List all sessions
- `POST /api/sessions` - Create new session
- `GET /api/sessions/:id` - Get session details
- `PUT /api/sessions/:id` - Update session metadata
- `PATCH /api/sessions/:id/star` - Toggle star
- `PATCH /api/sessions/:id/provider` - Switch provider for a session
- `PATCH /api/sessions/:id/mode` - Switch permission mode
- `GET /api/sessions/:id/messages` - Load session messages
- `POST /api/sessions/:id/rewind` - Rewind to an earlier message

### Files

- `GET /api/files?path=` - List directory contents
- `GET /api/files/content?path=` - Read file content
- `POST /api/files` - Create file
- `PUT /api/files` - Update file
- `DELETE /api/files?path=` - Delete file

### Git

- `GET /api/git/status?path=` - Get git status
- `POST /api/git/stage` - Stage files
- `POST /api/git/commit` - Create commit
- `POST /api/git/pull` - Pull from remote
- `POST /api/git/push` - Push to remote
- `POST /api/git/branch/create` - Create branch
- `POST /api/git/generate-commit-message` - AI commit message

### GitHub

- `GET /api/github/repos` - List user repos
- `POST /api/github/repos` - Create repo
- `POST /api/github/clone` - Clone repo
- `POST /api/github/push` - Push to GitHub

### Commands

- `GET /api/commands` - List available commands
- `POST /api/commands/execute` - Execute command

### Providers & Usage

- `GET /api/cli-providers` - List configured CLI providers
- `GET /api/cli-providers/available` - Check provider availability/auth state
- `GET /api/cli-providers/diagnostics` - Run provider diagnostics
- `GET /api/cli-providers/:id/models` - List models for one provider
- `GET /api/usage/limits?provider=codex` - Fetch provider quota/limit data where supported
- `GET /api/analytics/summary` - Usage summary and pricing totals
- `GET /api/analytics/timeline` - Usage timeline for charts

### Settings, Extensions & MCP

- `GET /api/settings` / `PUT /api/settings` - User settings
- `GET/PUT/DELETE /api/settings/mistral-key` - Mistral Vibe key management
- `GET/PUT /api/settings/integrations` - OpenAI/ComfyUI integration settings
- `GET/POST/PUT/DELETE /api/mcp` - MCP server management and testing
- `GET/PUT /api/comfyui/settings` - ComfyUI endpoint configuration
- `POST /api/comfyui/generate` - Submit an image generation job
- `GET/POST/PUT/DELETE /api/claude-config/agents` - Shared agent files
- `GET/POST/PUT/DELETE /api/claude-config/skills` - Shared skill packs
- `GET/POST/PUT/DELETE /api/claude-config/plugins` - User and marketplace plugins
- `GET /api/codex/plugins`, `POST /api/codex/plugins/install`, `POST /api/codex/plugins/:id` - Codex plugin listing, install, and enable/disable flow

## WebSocket Events

### Client -> Server

- `session:send` - Send a message to the session's active provider
- `session:subscribe` - Subscribe to session updates
- `session:interrupt` - Interrupt the active CLI process
- `session:reconnect` - Reconnect with buffer replay

### Server -> Client

- `session:output` - Streaming text deltas
- `session:message` - Complete persisted message
- `session:thinking` - Thinking indicator (boolean)
- `session:tool_use` - Tool lifecycle (started / completed / error) with duration tracking
- `session:todos` - Todo list updates
- `session:usage` - Token usage data
- `session:compact` - Context compaction events
- `session:agent` - Subagent (Task tool) lifecycle events
- `session:mode` - Permission mode changes
- `session:status` - Session state changes

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Run `pnpm typecheck` and `pnpm lint`
5. Submit a pull request

## License

MIT License - see [LICENSE](LICENSE) for details.

## Acknowledgments

- [OpenAI](https://openai.com) for Codex
- [OpenCode](https://opencode.ai/) for multi-provider CLI routing
- [Mistral AI](https://mistral.ai/) for Mistral Vibe and Devstral models
- [Anthropic](https://anthropic.com) for Claude and Claude Code
