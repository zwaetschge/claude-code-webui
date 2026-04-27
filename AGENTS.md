# AGENTS.md

Notes on the multi-provider integration in Plum Code WebUI.

## Goals implemented

- Multi-provider CLI support (Claude Code, Codex, OpenCode) with per-session provider selection
- Provider switching inside a session restarts the underlying CLI cleanly
- Shared settings across providers (default working directory, tools list, settings UI)
- Per-CLI auth + state directories that survive container rebuilds
- Branding: Plum Code WebUI login, provider-specific visuals + logos
- ComfyUI MCP server for inline image generation (replaces the earlier Gemini image path)
- Android-builder MCP server for native app workflows on real devices

## Provider summary

| Provider | CLI | Process model | Config home |
|----------|-----|---------------|-------------|
| Claude Code | `claude` | persistent stream-json | `~/.claude` |
| Codex (OpenAI) | `codex` | per-turn — manager respawns on `turn.completed` | `~/.codex` |
| OpenCode | `opencode` | persistent, model routing for GLM (`z-ai/glm-*`), Kimi, and 75+ LLMs | `~/.opencode` |

All three CLIs ship inside the container; their config dirs are bind-mounted from `${CONFIG_DIR}` (default `./config`) so OAuth tokens and provider state persist across `docker compose up --build`.

## Provider switching behavior

- Switching provider inside a session restarts the CLI process cleanly
- UI shows provider badges per session in the dashboard and sidebar
- The previous "handover summary" / handoff-protocol injection has been removed — provider switches start a fresh CLI context

## Permission approval behavior

- Permission approvals do not resend the full user prompt
- A short "resume" hint is sent instead, to avoid duplicate responses

## OpenCode notes

- OpenCode handles GLM, Kimi, and other LLMs through its own model routing — there is no separate GLM provider in the WebUI
- Default model: `z-ai/glm-5.1` (override with `CLI_PROVIDER_OPENCODE_DEFAULT_MODEL`)
- Available model menu: empty = auto-discover from the installed CLI (override with `CLI_PROVIDER_OPENCODE_MODELS=…`)
- Debug stream events with `OPENCODE_DEBUG_EVENTS=1`

## Shared agents / skills / plugins

- Skills live in `~/.claude/skills/<name>/SKILL.md`
- Agents live in `~/.claude/agents/<name>.md`
- The WebUI auto-syncs external skill packs from these directories (in order):
  - `/mnt/user/AI/Skills` (primary)
  - `/mnt/unraid/AI/Skills` (fallback)
  - `WEBUI_SKILLS_DIRS` (comma-separated overrides)
- `.skill.zip` files are unpacked into `~/.claude/skills`
- The managed block in `AGENTS.md` and `CLAUDE.md` is appended/updated on each session — custom text outside the managed block is preserved

## Built-in MCP servers

Both registered in `config/claude/settings.json` → `mcpServers`. Loaded at CLI spawn — only available in **new** sessions.

### `comfyui-images`

- Script: `scripts/mcp-servers/comfyui.mjs`
- Tool: `generate_image` — submits to a LoRA Tester ComfyUI Flux server, polls for completion, downloads the PNG, saves to `data/generated/<uuid>.png`, returns `display_markdown` so Claude can render the image inline
- Targets (override via env vars `COMFYUI_API_URL`, `COMFYUI_BACKEND_URL`, `COMFYUI_OUTPUT_DIR`, `COMFYUI_PUBLIC_PREFIX`):
  - LoRA Tester backend: `http://192.168.1.126:8850`
  - ComfyUI direct: `http://192.168.1.23:8188`
- Defaults: `cfg=1.0`, `sampler=euler`, `megapixels=0.5`, `steps=6`, `aspect_ratio=1:1`

### `android-builder`

- Script: `scripts/mcp-servers/android-builder.mjs`
- ~25 tools across project lifecycle, build, install/launch, ADB device management, emulator, on-device testing
- Backend: `http://host.docker.internal:4000` (the `android-app-creator-backend` running on the host)
- Persistent device registry: pair a phone once via `adb_pair_wifi` + `adb_connect_wifi`, the backend stores it in `/app/data/known-devices.json` and auto-reconnects on startup
- See `~/.claude/skills/android-build/SKILL.md` for the full workflow — never call `adb` or `gradle` from `Bash`

## Auth allowlist

`AUTH_ALLOWED_EMAILS` (comma-separated) is the single source of truth for who can log in:

- Enforced for OAuth (GitHub, Google) via `findOrCreateUser` in `src/auth/passport.ts` — throws `EmailNotAllowedError`, callback redirects to `/connect?error=email_not_allowed`
- Enforced for basic-auth in `src/routes/basic-auth.ts` — returns `403 EMAIL_NOT_ALLOWED`
- Empty = no allowlist (only safe behind a private network or SSO proxy)
- First user matching `SEED_ADMIN_EMAIL` (or the first allowlist entry if unset) gets `role=admin` on first login

## Paths and mounts (container)

- Logos: `LOGOS_DIR=/app/logos` (override file mounts `/mnt/user/appdata/claude-code-webui/logos`)
- CLI homes (mounted from `${CONFIG_DIR}/<cli>`):
  - Claude Code → `/home/node/.claude`
  - Codex → `/home/node/.codex`
  - OpenCode → `/home/node/.opencode`
  - npm-global → `/home/node/.npm-global`
- Workspace: `${WORKSPACE_DIR}` → `/workspace` (configurable via `ALLOWED_BASE_PATHS`)

## Environment overrides

- `WEBUI_CONFIG_HOME` or `CLAUDE_CONFIG_HOME`: override the shared Claude config home
- `WEBUI_SKILLS_DIRS` or `CLAUDE_SKILLS_DIRS`: extra skill pack folders
- `CLI_PROVIDER_CLAUDE_MODELS`, `CLI_PROVIDER_CODEX_MODELS`, `CLI_PROVIDER_OPENCODE_MODELS`: override the model menu per provider (empty = auto-discover)
- `CLI_PROVIDER_OPENCODE_DEFAULT_MODEL`: default OpenCode model (default `z-ai/glm-5.1`)
- `OPENCODE_DEBUG_EVENTS=1`: log raw OpenCode events to backend logs

## Removed paths (do not reintroduce)

The following used to exist in earlier versions of this repo and have been deleted:

- Gemini provider + `~/.gemini` config home + Gemini image generation service
- GLM as a top-level provider (now folded into OpenCode's model routing)
- Orchestration manager + task router + worker pool
- Ralph autonomous loop engine
- Watchdog health monitoring + Telegram alerts
- Self-rebuild HTTP API + handover protocol
- "Repair-bot" sidekick container

The Rebuild Robot sidecar (`scripts/rebuild-robot-sidecar.sh`, opt-in via `docker-compose.override.yml`) is the only remaining self-rebuild path.

## Known gaps / follow-ups

- Codex usage endpoint requires a valid cookie (`CODEX_USAGE_COOKIE` / `CODEX_USAGE_URL`); otherwise reports unsupported
- MCP tools are bound at CLI spawn — existing sessions won't see new tools until a fresh chat is started
