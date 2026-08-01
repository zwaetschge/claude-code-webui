# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository

Web UI for Codex, OpenCode, Pi, and Claude Code harnesses. **Codex is the default provider** — Anthropic is restricting `claude -p` / moving to a credit system, so Codex took over as the primary CLI. Claude is still available as a legacy option. pnpm monorepo deployed as a single Docker container on Unraid.

## Commands

```bash
pnpm install                # install workspace deps
pnpm dev                    # run backend + frontend in parallel (tsx watch + vite)
pnpm build                  # build all packages (tsc for backend/shared, vite for frontend)
pnpm typecheck              # tsc --noEmit across workspace
pnpm lint                   # eslint
pnpm format                 # prettier --write
pnpm format:check           # prettier --check (CI)

./scripts/install.sh        # interactive installer (prereq check, .env gen, build, up, codex login). Re-runnable; --reset wipes .env, --skip-login skips OAuth bootstrap, --non-interactive uses defaults.
./scripts/start-webui.sh    # dev helper: generates ephemeral SESSION_SECRET/JWT_SECRET, kills stale PIDs, logs to .logs/, writes PIDs to .pids/

# Backend-specific (run from packages/backend)
pnpm db:migrate             # apply SQLite migrations (better-sqlite3)
pnpm db:seed                # seed dev data
```

Dev ports: backend `3006`, frontend `5173`. Docker maps `4545:3001` (container listens on 3001).

Node `>=20`, pnpm `>=9` (packageManager pinned to `pnpm@9.15.0`).

## Architecture

### Packages

| Package             | Purpose                                                                                                     |
| ------------------- | ----------------------------------------------------------------------------------------------------------- |
| `packages/backend`  | Express + Socket.IO server, SQLite via better-sqlite3, spawns Codex/OpenCode/Claude CLIs as child processes |
| `packages/frontend` | React 18 + Vite SPA, Radix UI, Tailwind, Zustand, Socket.IO client                                          |
| `packages/shared`   | TypeScript types shared between backend and frontend                                                        |
| `packages/desktop`  | Desktop shell wrapper                                                                                       |
| `packages/android`  | Android client                                                                                              |

### Backend

Entry: `packages/backend/src/index.ts`. Routes live in `src/routes/` (~30 modules — sessions, auth, providers, files, git, github, mcp, etc.). Services in `src/services/` — the critical one is `src/services/claude/ClaudeProcessManager.ts`, which owns all CLI lifecycle.

**CLI process model** (`ClaudeProcessManager` — owns all four harnesses despite the name):

- **Codex** (default): `codex exec --json` per-turn; manager respawns on `turn.completed` / process exit. Streaming via `item.delta` / `agent_message.delta` / `text.delta` events (Codex 0.130+). Resume via transcript replay — `buildCodexContextPrefix()` reads prior turns from SQLite and prepends them to stdin on respawn.
- **OpenCode**: server-backed (HTTP/SSE), full stream-json, native resume.
- **OpenCode isolation**: one server process, SSE stream, config/data directory, and OAuth/account state per WebUI user under `~/.opencode/users/<sha256-user-key>`. Legacy global OAuth state is not auto-assigned; reconnect affected users once through the WebUI.
- **Pi**: persistent JSONL RPC; shares OpenCode provider connections and loads the shared skills, converted agents, and MCP bridge.
- **Claude** (legacy): `claude --print --verbose --output-format stream-json --input-format stream-json --include-partial-messages --dangerously-skip-permissions`.
- Parses stream-json events and forwards them over Socket.IO. Message queue accepts input while the CLI is working; interrupts via SIGINT.

**Key Socket.IO events** (server → client):

- `session:output` — streaming text deltas
- `session:message` — persisted messages
- `session:thinking` — thinking indicator (boolean)
- `session:tool_use` — tool lifecycle (started/completed/error)
- `session:agent` — subagent (Task tool) activity
- `session:status` — session state changes

**Auth**: Express session + JWT, Passport strategies for GitHub and Google OAuth, plus a Basic Auth guard stored in SQLite (`app_config` table). Harness login routes: `/auth/codex`, `/auth/opencode`, `/auth/pi`, `/auth/claude` (Claude flagged as legacy in the UI). `/auth/providers` advertises which providers are usable based on `isProviderAvailable()` checks.

**Admin / helper LLM** (`packages/backend/src/utils/adminLLM.ts`): one-shot text completion for internal features (commit message generation, etc.). Prefers Codex → OpenCode → Claude; override via `ADMIN_LLM_PROVIDER`. Used by `routes/git.ts` `/generate-commit-message` — no longer hardcoded to `claude --print -p`.

**Claude custom API**: Settings → General → Claude Code stores a per-user Anthropic-compatible base URL, encrypted API token, and optional Opus/Sonnet/Haiku model mappings through `GET/PUT/DELETE /api/settings/claude-api`. New or restarted Claude sessions receive the corresponding `ANTHROPIC_*` environment variables. The Z.AI preset is `https://api.z.ai/api/anthropic`; arbitrary compatible URLs are accepted.

**Usage / analytics** (cross-provider): every turn's tokens land idempotently in `usage_history` via `saveUsageToDatabase` in `ClaudeProcessManager`, keyed by session, explicit provider, and stable turn id. Pi and OpenCode therefore remain separate even when they route the same model id. For Codex, `translateCodexMessage` captures `turn.completed.usage` (`input_tokens` + `cached_input_tokens` + `output_tokens` + `reasoning_output_tokens`) and writes them directly to `proc.turnInputTokens` etc. Per-provider cost uses the shared rate-card in `packages/shared/src/types/llm-pricing.ts`; startup migrations reprice `usage_history.cost_usd` when `LLM_PRICING_RATE_CARD_VERSION` changes. Unknown model prices stay unpriced rather than inheriting a fallback. Live usage limits surfaced via `/api/usage/limits?provider=codex` from ChatGPT's `backend-api/codex/usage` endpoint (needs `Authorization: Bearer` + `chatgpt-account-id` header — see `routes/usage.ts`).

**Security middleware** (`src/index.ts`): strict Helmet CSP (no `unsafe-inline` scripts), `trust proxy` configurable via `TRUST_PROXY`, per-bucket rate limiters in `src/middleware/rateLimiter.ts` (key = `userId` or `req.ip`, never raw `X-Forwarded-For`). CORS origins from `FRONTEND_URL` + `CORS_ALLOWED_ORIGINS`.

### Frontend

Entry: `packages/frontend/src/main.tsx`. Main chat view: `src/pages/SessionPage.tsx`. Tool rendering: `src/components/chat/ToolExecutionCard.tsx` — detects `Task`/`Agent` tools as subagents and renders them with a distinct border-left accent, tinted background, and "SUBAGENT" badge. Subagent icon mapping lives in the same file (`agentTypeMap`).

Store: `src/stores/useSessionStore.ts` (Zustand) holds per-session `toolExecutions`, `activity`, and `activeAgent` state.

WebSocket client: `src/services/socket.ts`.

## Deployment

Compose is split into two files:

- **`docker-compose.yml`** — portable, in git. Single legacy `claude-code-webui` service key on `${WEBUI_PORT:-4545}:3001`, building the `plum-code-webui:latest` image. Volumes use env-var-driven defaults (`${DATA_DIR:-./data}`, `${CONFIG_DIR:-./config}`, `${WORKSPACE_DIR:-./workspace}`). Safe to publish.
- **`docker-compose.override.yml`** — site-specific, **gitignored**. Holds Traefik labels for `code.zwaetschge-webui.ch`/`preview.code.zwaetschge-webui.ch`, absolute `/mnt/cache/appdata/plum-code-webui/...` host paths, the read-only Docker socket proxy, the Rebuild Robot sidecar, and the external `brian_traefik-public` network. Compose merges both automatically.

A template for other operators lives at `docker-compose.override.yml.example`.

```bash
./scripts/install.sh                # interactive: collects env, builds, starts, runs codex login (other providers from UI)
docker compose up -d --build        # if you already have .env + an override
```

**The raw docker.sock is never mounted into the main WebUI.** This trusted-admin site exposes filtered `BUILD`, `IMAGES`, and `CONTAINERS` groups through `docker-socket-proxy` with `POST=1`; provider CLIs inherit that filtered `DOCKER_HOST`. Keep runner access admin-only, leave `EXEC`, `NETWORKS`, and `VOLUMES` disabled, and never restore the raw socket mount on the main service.

**Rebuild Robot sidecar** (`scripts/rebuild-robot-sidecar.sh`): POSIX sh watcher intended to run as a Compose sidecar (defined in the override file). It protects the previous image, rebuilds/restarts the main service, requires `/health/ready` plus the expected candidate image id, and automatically rolls back a failed candidate. It writes `REBUILD_ROBOT_REPORT.md` + `data/rebuild-robot-status.json`. This is the only remaining self-rebuild path.

### Unraid persistence

The override file pins these to absolute paths so state survives container rebuilds:

- `/mnt/cache/appdata/plum-code-webui/data` → `/app/packages/backend/data` (SQLite DB, session files)
- `/mnt/cache/appdata/plum-code-webui/config/codex` → `/home/node/.codex` (primary provider)
- `/mnt/cache/appdata/plum-code-webui/config/opencode` → `/home/node/.opencode`
- `/mnt/cache/appdata/plum-code-webui/config/pi` → `/home/node/.pi`
- `/mnt/cache/appdata/plum-code-webui/config/claude` → `/home/node/.claude` (legacy)
- `/mnt/cache/appdata/plum-code-webui/config/npm-global` → `/home/node/.npm-global`
- `/mnt/cache/appdata/plum-code-webui/config/ssh` → `/home/node/.ssh` (ro)
- `/mnt/cache` → `/mnt/cache` (workspace access)

The portable compose's defaults (`./data`, `./config`, `./workspace`) sit alongside the project dir for fresh self-host installs.

### Basic Auth recovery

Credentials stored in SQLite at `data/claude-webui.db`, table `app_config`, keys `basic_auth_username`, `basic_auth_password` (bcrypt), `basic_auth_enabled`. Reset example:

```bash
sqlite3 /mnt/cache/appdata/plum-code-webui/data/claude-webui.db \
  "update app_config set value='NEW_USERNAME' where key='basic_auth_username'; \
   update app_config set value='BCRYPT_HASH'    where key='basic_auth_password'; \
   update app_config set value='true'           where key='basic_auth_enabled';"
```

Set `basic_auth_enabled` to `false` to disable.

## Shared Agents / Skills / Plugins

- Runtime-active core skills live in `~/.claude/skills/<name>/SKILL.md`; other workflows remain searchable under `~/.claude/skill-catalog`, while optional design/writing presets live under `~/.claude/style-library/{design,writing}`.
- Settings → Extensions → Skills, `GET /api/claude-config/skills?library=all`, and `node /app/scripts/capability-catalog.mjs search "<task>"` expose active, on-demand, and style entries. Consolidated old names resolve through `~/.claude/skill-aliases.json`; retired entries are not re-imported.
- Agents live in `~/.claude/agents/<name>.md`
- The WebUI auto-syncs external skill packs from these directories, in order:
  - `/mnt/user/AI/Skills` (primary)
  - `/mnt/unraid/AI/Skills` (fallback)
  - `WEBUI_SKILLS_DIRS` (comma-separated overrides)
- `.skill.zip` imports respect active/on-demand catalog state, aliases, and retired-name tombstones.
- The managed block in `AGENTS.md` and `CLAUDE.md` is appended/updated on each session; custom text outside the managed block is preserved.

**Superpowers** from [obra/Superpowers](https://github.com/obra/Superpowers) are disabled across Plum Code by default. Only `SUPERPOWERS_ENABLED=true` opts the whole instance back in; `false` removes Plum-managed skills, disables provider registration, and suppresses bootstrap injection for every provider, user, and workspace. When enabled, skills install into `~/.claude/skills`; Codex also gets a managed local `superpowers@plum-managed` plugin cache/config entry plus the `~/.agents/skills` fallback, OpenCode uses `skills.paths` without the upstream auto-bootstrap plugin, and Claude uses native `~/.claude/skills`. Existing user skills are not overwritten unless they carry `.plum-superpowers.json`.

The style library contains 37 curated design profiles and 32 writing profiles. They are optional session presentation layers, not globally active skills. Legacy style names remain searchable aliases; see `AGENTS.md` § "Style preset library" for maintenance and validation.

## Environment Variables

Schema: `packages/backend/src/config.ts` (zod-validated, fails fast on startup).

Required:

- `SESSION_SECRET` — min 32 chars
- `JWT_SECRET` — min 32 chars

Common:

- `PORT` (default `3001`), `HOST` (default `0.0.0.0`), `NODE_ENV`
- `FRONTEND_URL` (default `http://localhost:5173`)
- `CORS_ALLOWED_ORIGINS` — comma-separated additional origins
- `AUTH_ALLOWED_EMAILS` — comma-separated email allowlist enforced for both OAuth and basic-auth logins. Empty = no allowlist (only safe behind a private network or SSO proxy). Enforcement: `findOrCreateUser` in `src/auth/passport.ts` throws `EmailNotAllowedError` (callback redirects to `/connect?error=email_not_allowed`); `src/routes/basic-auth.ts` returns `403 EMAIL_NOT_ALLOWED`.
- `TRUST_PROXY` (default `1`) — Express `trust proxy` value; hop count, boolean, or CIDR list. Setting `true` without a guarding proxy defeats IP rate-limiting.
- `ALLOWED_BASE_PATHS` (default `/home,/Users`) — comma-separated path allowlist for workspace access
- `GITHUB_CLIENT_ID`/`GITHUB_CLIENT_SECRET`/`GITHUB_CALLBACK_URL`
- `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`/`GOOGLE_CALLBACK_URL`
- `CLAUDE_OAUTH_ENABLED` (default `true`; set `false` to disable) — Claude is legacy, still works but no longer the default
- `CLAUDE_USER_EMAIL` — display-only (Anthropic API is Cloudflare-gated)
- `ADMIN_LLM_PROVIDER` — override the admin/helper LLM choice for commit messages etc. (default order: `codex` → `opencode` → `claude`)
- `ENCRYPTION_KEY` — for encrypted stored credentials
- `WEBUI_HOOK_SECRET` — shared secret proving a request came from the permission-prompt hook; auto-generated per process if unset
- `PREVIEW_HOSTNAME` — hostname of the preview subdomain for in-container dev servers
- `CLI_PROVIDER_CODEX_MODELS`, `CLI_PROVIDER_OPENCODE_MODELS`, `CLI_PROVIDER_PI_MODELS`, `CLI_PROVIDER_CLAUDE_MODELS`, `CLI_PROVIDER_<PROVIDER>_DEFAULT_MODEL` — override available models / default model per provider
- `CLI_PROVIDER_OPENCODE_DEFAULT_AGENT` / `CLI_PROVIDER_OPENCODE_STYLE_PROMPT` — OpenCode's WebUI primary agent and Codex-like communication style override

## ComfyUI Image Generation (built-in)

The WebUI talks to a ComfyUI server **directly** — no LoRA Tester sidecar. Three workflow templates ship baked in; agents can vary prompt/steps/seed/aspect/model/LoRA per call.

- **Backend service**: `packages/backend/src/services/comfyui/` — `workflows.ts` (3 templates + param map), `client.ts` (ComfyUI HTTP wrapper: `/prompt`, `/history`, `/view`, `/upload/image`, `/system_stats`), `index.ts` (orchestrator + job map).
- **REST endpoints** (`packages/backend/src/routes/comfyui.ts`):
  - `GET /api/comfyui/workflows` — list templates + param schemas
  - `GET /api/comfyui/settings`, `PUT /api/comfyui/settings` (admin) — URL + enabled flag
  - `GET /api/comfyui/test` — `/system_stats` probe (used by the "Test" button in Settings)
  - `POST /api/comfyui/upload-image` — forwards multipart to ComfyUI's `/upload/image` for the edit workflow
  - `POST /api/comfyui/generate` — submit, returns `generationId`
  - `GET /api/comfyui/generation/:id` — poll status + final URL
  - `POST /api/comfyui/internal/generate` — hook-secret-auth synchronous variant for the MCP server
- **Workflows**:
  - `z-image-turbo` — fast T2I, ~5s, Z-Image Turbo + qwen3_4b CLIP, 9 steps `dpmpp_2m_sde`
  - `flux2-klein-t2i` — quality T2I, Flux.2 Klein 9B + Turbo LoRA + TeaCache, 8 steps `euler`, `SamplerCustomAdvanced`
  - `flux2-klein-edit` — image-edit via Flux.2 Klein + `ReferenceLatent`, 8 steps, requires `input_image` filename uploaded first
- **Configuration**: ComfyUI URL stored in `app_config.comfyui_url` (settable from Settings → Integrations). Defaults to `$COMFYUI_URL` env or `http://192.168.1.23:8188`. Per-install — not user-scoped.
- **MCP server**: `scripts/mcp-servers/comfyui.mjs` — zero-dep Node stdio bridge. Exposes 3 tools: `generate_image` (fast), `generate_image_quality` (Flux.2 T2I), `edit_image` (Flux.2 edit). Calls `POST /api/comfyui/internal/generate` with the WebUI hook secret (inherited from CLI env). Workflow definitions, the ComfyUI URL, and rate limits live in the backend so the MCP stays thin.
- **Static serving**: `/generated/*.png` served by `packages/backend/src/index.ts`, gated by passport session cookie auth. `<img>` tags don't send Bearer tokens so session-cookie auth is required.
- **Frontend rendering**: `MemoizedMarkdown.tsx` `img` override wraps generated images in a click-through `<a>` (target `_blank`) with rounded borders + lazy loading.
- **Caveats**: MCP tools load at CLI spawn — existing sessions won't see the new tools until you start a fresh one. Changing the ComfyUI URL takes effect immediately for new jobs (the orchestrator re-reads `app_config` on each call).

## Android App Creator Integration (MCP)

A second MCP server, **android-builder**, lets every webui session (Codex / OpenCode / Claude) build, install, launch, and test Android apps on real devices via the `android-app-creator` Docker container running on the host.

- **MCP server**: `scripts/mcp-servers/android-builder.mjs` — zero-dep Node stdio server, registered in `config/claude/settings.json` as `mcpServers.android-builder`. Exposes ~25 tools across project lifecycle, build, install/launch, ADB device management, emulator, and on-device testing (logcat / shell / screencap).
- **Backend target**: `http://host.docker.internal:4000` (the `android-app-creator-backend` listens on host port 4000). The compose file adds `extra_hosts: ["host.docker.internal:host-gateway"]` so this resolves from inside the webui container. Override via env `ANDROID_BUILDER_URL`.
- **Persistent device registry**: the builder backend stores known wifi pairings in `/app/data/known-devices.json`. On startup it auto-reconnects every entry with `autoReconnect=true`. **The user only pairs a phone once** — `adb_pair_wifi` + `adb_connect_wifi`, then it survives container restarts. Tools: `adb_known_devices`, `adb_forget_device`, `adb_set_friendly_name`, `adb_set_auto_reconnect`, `adb_reconnect_all`.
- **Safety**: `adb_shell` runs through a backend denylist (`rm -rf /`, `dd if=`, `mkfs`, fork bombs, `su root`). `adb_screenshot` requires an absolute `.png` path inside the builder container.
- **Skill pack**: `~/.claude/skills/android-build/SKILL.md` — invoke via the Skill tool. Documents standard workflows (cold start, build → ship → verify, new device pairing) and anti-patterns. Always go through this MCP — never call `adb` or `gradle` from `Bash`.
- **Caveats**: new sessions only — MCP tools are loaded at CLI spawn. Existing sessions won't see `android_*` / `adb_*` tools until you start a fresh chat. The android-app-creator container itself runs separately at `/mnt/user/AI/plum-code/android-app-creator/`.

## Godot + Blender MCP

Two built-in zero-dep MCP bridges are registered in `~/.claude/settings.json`
and mirrored into Codex/OpenCode for new sessions:

- **godot** (`scripts/mcp-servers/godot.mjs`) — tools:
  `godot_info`, `godot_create_project`, `godot_list_project`,
  `godot_validate_project`, `godot_run_gdscript`, `godot_export_project`.
  Project scaffolding and inspection work without an editor binary. Validation,
  scripted editor runs, and exports require `GODOT_BIN` or a `godot`/`godot4`
  binary on `PATH`.
- **blender** (`scripts/mcp-servers/blender.mjs`) — tools:
  `blender_info`, `blender_run_python`, `blender_create_asset`,
  `blender_inspect_file`, `blender_render_preview`. The runtime image installs
  `blender-headless` and defaults `BLENDER_BIN=blender-headless`, so sessions
  can generate procedural `.blend`, `.glb`, `.gltf`, `.obj`, `.stl`, or `.fbx`
  assets via Blender Python.

Godot games should still follow the `game-engine-godot` skill: composable
scenes, reviewable Resources/data, InputMap actions, export presets, and Android
verification through android-builder when targeting phones.

## Multi-Provider Notes

Four harness backends are wired into `ClaudeProcessManager` (insertion order in `CLI_PROVIDERS` dictates UI list order):

- **Codex** (`codex`) — **default / primary**. Per-turn process model; the manager detects `turn.completed` and respawns on the next input. Streaming and resume are simulated:
  - **Streaming**: `translateCodexMessage` handles `item.delta` / `agent_message.delta` / `text.delta` / `response.output_text.delta` events from `codex exec --json` (Codex 0.130+) and forwards each chunk as a `session:output` delta. Falls back gracefully to whole-message emit on `item.completed` if no deltas arrive.
  - **Resume**: `buildCodexContextPrefix()` reads the last 40 messages (≤24k chars) from SQLite and prepends them as a `[Prior conversation context]` block to stdin on each respawn — codex CLI has no native `--resume` flag.
- **OpenCode** (`opencode`) — server-backed (HTTP/SSE), full stream-json, native resume via `--session`. Routes 75+ LLMs (GLM `z-ai/glm-*`, Kimi, etc.).
- **Pi** (`pi`) — persistent JSONL RPC, sharing OpenCode's API connections/model catalogue plus the shared skills, converted agents, and MCP bridge.
- **Claude Code** (`claude`) — legacy. Persistent stream-json process. Still works but no longer surfaced as default.

Provider config homes (persisted via compose volumes): `~/.codex`, `~/.local/share/opencode`, `~/.pi`, `~/.claude`. See `AGENTS.md` for the broader multi-provider workflow and skill-pack sync conventions.

**Default provider selection**:

- Backend: `routes/sessions.ts` schema defaults `cliProvider` to `'codex'`; `db/index.ts` migration default for `sessions.cli_provider` column is `'codex'`.
- Frontend: `packages/frontend/src/lib/providers.ts` maps the neutral `plum` UI brand to CLI `codex` (was `claude`).
- Custom agents (`custom_agents.model` default in SQL) and `/model`-command fallback both use `gpt-5.5`.

## Pitfalls

- **Stale doc references**: earlier versions of this file, `README.md`, and `AGENTS.md` mention Gemini image generation, an orchestration service, a Ralph worker, a watchdog, a self-rebuild API, a repair-bot sidekick container, and a handover protocol. **None of those exist anymore** — all removed from the live code. Source-of-truth order: code > this file > README/AGENTS.
- **Never run `docker compose down`, `docker compose up -d --force-recreate`, or any container-recreate command from inside the WebUI container** — it will kill the running CLI session and leave the container in `Created` state on the new image. For redeploys, see `AGENTS.md` § "Rebuild / redeploy protocol".
