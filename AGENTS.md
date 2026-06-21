# AGENTS.md

Notes on the multi-provider integration in Plum Code WebUI.

## Goals implemented

- **Codex is now the default / primary provider** — Anthropic is restricting `claude -p` / introducing a credit system, so Codex took over as the main horse. Claude stays available as a legacy option.
- Multi-provider CLI support (Codex, OpenCode, Mistral Vibe, Claude Code) with per-session provider selection
- Provider switching inside a session restarts the underlying CLI cleanly
- Streaming + resume simulated for Codex (chunk-level deltas + transcript replay) so the UX is on par with the natively-streaming providers
- Admin/helper LLM calls (commit message generation, etc.) route through `utils/adminLLM.ts` with the same Codex-first preference
- Per-CLI auth + state directories that survive container rebuilds
- Dedicated login routes for every provider: `/auth/codex`, `/auth/opencode`, `/auth/vibe`, `/auth/claude`
- Branding: Plum Code WebUI login, provider-specific visuals + logos; Codex shown first, Claude under a "Legacy" label
- ComfyUI MCP server for inline image generation (replaces the earlier Gemini image path)
- Android-builder MCP server for native app workflows on real devices

## Provider summary

| Provider           | CLI        | Process model                                                                                                           | Config home               | Default?    |
| ------------------ | ---------- | ----------------------------------------------------------------------------------------------------------------------- | ------------------------- | ----------- |
| **Codex** (OpenAI) | `codex`    | per-turn — manager respawns on `turn.completed`. Streaming via `*.delta` events; resume via transcript prefix on stdin. | `~/.codex`                | **yes**     |
| OpenCode           | `opencode` | server-backed (HTTP/SSE), full stream-json, native resume; routes 75+ LLMs (GLM `z-ai/glm-*`, Kimi, etc.)               | `~/.local/share/opencode` | no          |
| Mistral Vibe       | `vibe`     | argv-based prompt (`-p TEXT`), per-turn spawn; isolated `VIBE_HOME` per WebUI session; `--continue` flag for resume     | `~/.vibe`                 | no          |
| Claude Code        | `claude`   | persistent stream-json — legacy                                                                                         | `~/.claude`               | no (legacy) |

All four CLIs ship inside the container; their config dirs are bind-mounted from `${CONFIG_DIR}` (default `./config`) so OAuth tokens and provider state persist across `docker compose up --build`.

## Provider switching behavior

- Switching provider inside a session restarts the CLI process cleanly
- UI shows provider badges per session in the dashboard and sidebar
- The previous "handover summary" / handoff-protocol injection has been removed — provider switches start a fresh CLI context

## Permission approval behavior

- Permission approvals do not resend the full user prompt
- A short "resume" hint is sent instead, to avoid duplicate responses

## Codex notes (primary)

- Default model: `gpt-5.5` (override with `CLI_PROVIDER_CODEX_DEFAULT_MODEL`)
- Available model menu: hardcoded fallback list; runtime list comes from `~/.codex/models_cache.json` (filtered to `visibility=list`, sorted by priority). Cache refreshes via the codex CLI itself; if the user's auth token is expired, the dropdown freezes on whatever was last fetched.
- Streaming is simulated — `translateCodexMessage` in `ClaudeProcessManager` listens for `item.delta`, `agent_message.delta`, `text.delta`, and `response.output_text.delta` events and emits `session:output` deltas. Falls back to full-message emit on `item.completed` if the CLI doesn't send deltas (older versions).
- Resume is simulated — `buildCodexContextPrefix()` reads the last 40 turns (≤24k chars) from SQLite and prepends them as a `[Prior conversation context]` block to stdin on each respawn. Codex CLI has no native `--resume`.
- Per-turn respawn is required: `codex exec` is single-shot. `respawnCodexProcess` creates a fresh child on each user message and reattaches stdout/stderr handlers.

## OpenCode notes

- OpenCode handles GLM, Kimi, and other LLMs through its own model routing — there is no separate GLM provider in the WebUI
- Default model: `z-ai/glm-5.1` (override with `CLI_PROVIDER_OPENCODE_DEFAULT_MODEL`)
- Available model menu: empty = auto-discover from the installed CLI (override with `CLI_PROVIDER_OPENCODE_MODELS=…`)
- WebUI defaults OpenCode sessions to the native `build` primary agent (`CLI_PROVIDER_OPENCODE_DEFAULT_AGENT`) and injects a Codex-like communication contract via the managed `build.prompt`; override with `CLI_PROVIDER_OPENCODE_STYLE_PROMPT`, or set it to `0`/`false` to disable
- Debug stream events with `OPENCODE_DEBUG_EVENTS=1`

## Mistral Vibe notes

- Names in `CLI_PROVIDER_VIBE_MODELS` must match `[[models]].name` in `~/.vibe/config.toml`. Vibe ships with `mistral-vibe-cli-latest` (alias `mistral-medium-3.5`) and `devstral-small-latest`.
- Default model: `mistral-vibe-cli-latest`. Vibe has no `--model` flag; the spawner relies on `config.toml`'s `active_model`.
- Argv-based prompt: each turn appends `-p <message>` to argv just before exec. No stdin handoff.
- Per-session isolation: `VIBE_HOME=~/.vibe/webui-sessions/{sessionId}` so each WebUI chat is an isolated vibe agent session. `--continue` reuses the same VIBE_HOME to resume.
- Mistral API key managed in WebUI settings: `GET/PUT/DELETE /settings/mistral-key`, encrypted via `ENCRYPTION_KEY`.
- Vibe does NOT support permission modes (`supportsModes: false`); danger mode is unsupported.

## Admin / helper LLM

`packages/backend/src/utils/adminLLM.ts` provides one-shot text completion for internal WebUI features (commit message generation, future summaries, etc.) — NOT the user's interactive session.

- Order of preference: `codex` → `opencode` → `vibe` → `claude`
- Override via env `ADMIN_LLM_PROVIDER=codex|opencode|vibe|claude`
- Used by `routes/git.ts` `/generate-commit-message` (was hardcoded `claude --print -p ...`)
- Each provider runs in its native one-shot mode: `codex exec --skip-git-repo-check --ephemeral <prompt>`, `opencode run <prompt>`, `vibe --trust <prompt>`, `claude --print -p <prompt>`
- Codex uses `--ephemeral` so admin calls don't pollute `~/.codex/sessions/` and break the resume picker

## Cross-provider usage & analytics

### Token capture into `usage_history`

`ClaudeProcessManager.saveUsageToDatabase` is the single write path for the
analytics page. It reads from `proc.turnInputTokens / turnOutputTokens /
turnCacheReadTokens / turnCacheCreationTokens` and skips the insert when the
sum is zero. Each provider feeds those fields differently:

- **Claude** — `message_start` + `message_delta` events populate per-turn fields
  (handlers in `ClaudeProcessManager.ts` lines ~3263 and ~3284).
- **Codex** — `turn.completed.usage` event carries
  `{input_tokens, cached_input_tokens, output_tokens, reasoning_output_tokens}`.
  `translateCodexMessage` sets `proc.turnInputTokens` etc directly (reasoning
  output is folded into `output_tokens` because OpenAI bills it that way).
  **Without that direct set, the `result`-message handler downstream only updates
  the cumulative `totalInputTokens` and the turn fields stay at 0 → DB write
  skipped → Codex sessions invisible in analytics.** First bug, fixed.

  **Second bug, also fixed:** In `codex exec resume` mode, `turn.completed.usage`
  reports **cumulative** token counts (grows monotonically across the resumed
  session), not per-turn values. Writing the raw counts every turn produced
  single rows with 5M+ tokens and inflated daily totals to 180M. Fix: track
  `proc.codexLastReportedTokens` and write the delta from the last snapshot.
  Edge cases handled: first call (no snapshot) → write raw; any counter decrease
  (new session / fresh spawn) → write raw; otherwise → write delta. Followed by
  a 1M-per-turn sanity cap on each field so legitimate large turns pass through
  but rogue values get clamped. Schema difference vs Claude: Codex's
  `input_tokens` _includes_ `cached_input_tokens` (overlapping); Claude's are
  disjoint. We split into a disjoint pair after the delta calc so analytics
  math (`turnInputTokens + turnCacheReadTokens`) stays consistent.

- **OpenCode** — `usage_summary` event from the HTTP/SSE stream.
- **Vibe** — final `metadata` line of the JSON output.

### Per-model pricing (`llm-pricing`)

USD per 1M tokens, per direction, in
`packages/shared/src/types/llm-pricing.ts`. `ClaudeProcessManager` uses the
same shared rate-card as the analytics tab. `usage_history.cost_usd` is a
derived API-equivalent value: startup migrations reprice existing rows when
`LLM_PRICING_RATE_CARD_VERSION` changes. Unknown models must stay unpriced
instead of silently inheriting a fallback.

| Model family              | Input | Output | Cache read | Cache write |
| ------------------------- | ----- | ------ | ---------- | ----------- |
| Claude Opus 4.5+          | 5     | 25     | 0.5        | 6.25        |
| Claude Sonnet 4           | 3     | 15     | 0.3        | 3.75        |
| Claude Haiku 4.5          | 1     | 5      | 0.1        | 1.25        |
| gpt-5.5                   | 5     | 30     | 0.5        | 0           |
| gpt-5.4                   | 2.5   | 15     | 0.25       | 0           |
| gpt-5.4-mini              | 0.75  | 4.5    | 0.075      | 0           |
| gpt-5.3-codex / 5.2-codex | 1.75  | 14     | 0.175      | 0           |
| z-ai/glm-5.1              | 1.4   | 4.4    | 0.26       | 0           |
| z-ai/glm-5                | 1     | 3.2    | 0.2        | 0           |
| z-ai/glm-4.7/4.6/4.5      | 0.6   | 2.2    | 0.11       | 0           |
| Gemini 3.1 Pro Preview    | 2     | 12     | 0.2        | 0           |
| Mistral Medium 3.5        | 1.5   | 7.5    | 1.5        | 1.5         |
| Devstral Small 2          | 0.1   | 0.3    | 0.1        | 0.1         |

Codex models are charged at OpenAI rate-card even when the user is on a
ChatGPT subscription — the dollar number is "equivalent API spend" so the
chart compares apples-to-apples with Claude API metering.

### Provider grouping in the chart

`packages/shared/src/types/cli-providers.ts` exports `getProviderLabelForModel()`
and both backend analytics + frontend charts must use it. Detection rules:

- `startsWith('gpt-')` OR contains `codex` → Codex
- `startsWith('claude')` OR exact `opus / sonnet / haiku` → Claude
- `startsWith('mistral-')` OR `startsWith('devstral-')` → Vibe
- `startsWith('glm-')` OR `startsWith('z-ai/')` / `startsWith('zai/')` → OpenCode
- Contains `/` (e.g. `z-ai/glm-5.1`, `anthropic/claude-sonnet-4-5`) → OpenCode
- Else → Other

Do not duplicate this logic in route/page code — divergence makes the breakdown
chart disagree with the timeline.

## Codex usage limits (`/api/usage/limits?provider=codex`)

`routes/usage.ts` hits `https://chatgpt.com/backend-api/codex/usage` directly
using the codex CLI's OAuth tokens from `~/.codex/auth.json`. Critical headers
(matches `wakamex/codex-cli-usage`):

- `Authorization: Bearer <tokens.access_token>`
- `chatgpt-account-id: <id>` — required, else 401. Source order:
  1. `tokens.account_id` (recent codex versions write it here directly)
  2. `id_token` JWT claim `https://api.openai.com/auth.chatgpt_account_id`
- `User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 ... Safari/605.1.15`
  — Cloudflare flags some Linux/Firefox UAs and returns a JS challenge page
  instead of JSON. Override via `CODEX_USER_AGENT`.

Token refresh uses the hardcoded client ID `app_EMoamEEZ73f0CkXaXp7hrann`
(NOT the JWT `aud` claim — earlier code used `aud` and got rejected).

Response shape:

```jsonc
{
  "plan_type": "prolite",
  "rate_limit": {
    "primary_window":   { "used_percent": 12, "reset_at": 1778958045, "limit_window_seconds": 18000 },
    "secondary_window": { "used_percent":  8, "reset_at": 1779486595, "limit_window_seconds": 604800 }
  },
  "additional_rate_limits": [{ "limit_name": "code_review", "rate_limit": { ... } }]
}
```

`mapCodexUsage` maps `primary_window` → `fiveHour`, `secondary_window` →
`sevenDay`, surfaces `plan_type` as `subscriptionType`/`rateLimitTier` for the
badge, and forwards `additional_rate_limits` as an `additional` array.

## Shared agents / skills / plugins

- Skills live in `~/.claude/skills/<name>/SKILL.md`
- Agents live in `~/.claude/agents/<name>.md`
- The WebUI auto-syncs external skill packs from these directories (in order):
  - `/mnt/user/AI/Skills` (primary)
  - `/mnt/unraid/AI/Skills` (fallback)
  - `WEBUI_SKILLS_DIRS` (comma-separated overrides)
- `.skill.zip` files are unpacked into `~/.claude/skills`
- The managed block in `AGENTS.md` and `CLAUDE.md` is appended/updated on each session — custom text outside the managed block is preserved

### Design system skills (`design-*`)

67 design system skill packs are pre-installed from [bergside/awesome-design-skills](https://github.com/bergside/awesome-design-skills) (the [designmd.sh](https://designmd.sh/) collection). Each provides typography, color tokens, spacing rules, and component conventions for one specific aesthetic — drop the skill name into a prompt and the agent generates UI in that style.

- Location: `~/.claude/skills/design-<name>/SKILL.md` (with companion `DESIGN.md` for humans)
- All 67 are prefixed `design-` to avoid name collisions with generic words like `modern`, `simple`, `clean`
- Covers brand systems (`design-shadcn`, `design-material`, `design-claude`, `design-codex`, `design-ant`), aesthetic families (`design-brutalism`, `design-glassmorphism`, `design-neumorphism`, `design-skeumorphism`, `design-dithered`, `design-claymorphism`), moods (`design-luxury`, `design-cosmic`, `design-cafe`, `design-retro`, `design-vintage`, `design-cyberpunk`), and pop-culture references (`design-sega`, `design-pacman`, `design-tetris`, `design-matrix`, `design-doodle`)
- Discoverable by all four providers via the existing `~/.claude/skills` mount + `~/.agents/skills → ~/.claude/skills` symlink (Codex)
- Update: re-clone the repo, copy any new skill folders with the `design-` prefix, and rewrite the `name:` frontmatter to match the folder name (the install script in chat history shows the pattern)

## Built-in MCP servers

Claude-backed MCP servers are registered in `config/claude/settings.json` → `mcpServers` and mirrored into Codex at startup. Codex also appends a local `oracle` MCP server in `~/.codex/config.toml` for second-opinion consults. Loaded at CLI spawn — only available in **new** sessions.

## Image generation paths

Three parallel paths exist in CLI sessions. Pick by billing + batch size:

| Path              | Trigger                                         | Model                  | Counts against       | Best for                                    |
| ----------------- | ----------------------------------------------- | ---------------------- | -------------------- | ------------------------------------------- |
| Codex `$imagegen` | type `$imagegen ...` (or natural-language hint) | gpt-image-2            | Codex plan limits    | ad-hoc single images in a Codex chat        |
| `openai-image.sh` | `bash /app/scripts/openai-image.sh ...`         | gpt-image-2/1          | OpenAI API (API key) | reproducible asset batches, fixed filenames |
| ComfyUI MCP tools | `generate_image` / `_quality` / `edit_image`    | Z-Image / Flux.2 Klein | local GPU            | offline batch, stylistic control            |

- The shell wrapper `/app/scripts/openai-image.sh` uses only `curl + jq + base64` (no extra CLI install). It accepts `--prompt`, `--output`, `--model`, `--size`, `--quality`, `--n`, `--background`. Subcommands: `generate` and `edit`.
- `OPENAI_API_KEY` is exported into every CLI session via `buildIntegrationEnv()` (source order: `app_config.openai_api_key` → process env). Without it, the script refuses to run.
- The `openai-image-gen` skill (`~/.claude/skills/openai-image-gen/SKILL.md`) documents the decision tree and exact patterns; CLI sessions invoke it automatically when the user asks for icons/banners/asset batches.

### `comfyui-images`

The WebUI talks to ComfyUI **directly** — no LoRA Tester sidecar. Workflow definitions, settings, and rate limits live in the backend at `packages/backend/src/services/comfyui/`. The MCP server is a thin bridge over `POST /api/comfyui/internal/generate`.

- Script: `scripts/mcp-servers/comfyui.mjs` (zero-dep Node stdio)
- Tools:
  - `generate_image` — fast T2I via Z-Image Turbo (~5s/image, 9 steps `dpmpp_2m_sde`, qwen3_4b CLIP)
  - `generate_image_quality` — quality T2I via Flux.2 Klein 9B + Turbo LoRA + TeaCache (8 steps `euler`, `SamplerCustomAdvanced`)
  - `edit_image` — image-edit via Flux.2 Klein + ReferenceLatent. **Just pass an absolute path** to `input_image` (e.g. an attachment under `.claude-webui-attachments/`); the backend orchestrator's `materializeInputImage()` reads the file and uploads it to ComfyUI before running the workflow. If you pass a bare filename (no slashes) the backend assumes it's already in ComfyUI's `/input/` directory.
- Per-call overrides every tool exposes: `prompt`, `negative_prompt`, `seed`, `steps`, `cfg`, `sampler_name`, `aspect_ratio`, `megapixel`. Edit-only: `input_image`. Hidden but supported via the REST endpoint: `unet`, `clip`, `vae`, `lora_name`, `lora_strength`, `teacache_threshold`, `filename_prefix`.
- Auth: MCP inherits `WEBUI_HOOK_SECRET` + `WEBUI_SESSION_ID` from the CLI parent process; sends them as `X-Webui-Hook-Secret` + `X-Webui-Session-Id` headers. Session id resolves to the user for analytics attribution.
- ComfyUI URL: stored in `app_config.comfyui_url`, settable from Settings → Integrations ("Test" button does a `/system_stats` probe). Default fallback chain: app_config → `$COMFYUI_URL` env → `http://192.168.1.23:8188`. Change without restart — the orchestrator re-reads on every job.
- Output: PNG written to `data/generated/<uuid>.png`, served at `/generated/<uuid>.png` (passport session cookie auth). MCP returns `display_markdown` so the agent can paste `![alt](/generated/<uuid>.png)` inline.

### `android-builder`

- Script: `scripts/mcp-servers/android-builder.mjs`
- ~25 tools across project lifecycle, build, install/launch, ADB device management, emulator, on-device testing
- Backend: `http://host.docker.internal:4000` (the `android-app-creator-backend` running on the host)
- Persistent device registry: pair a phone once via `adb_pair_wifi` + `adb_connect_wifi`, the backend stores it in `/app/data/known-devices.json` and auto-reconnects on startup
- See `~/.claude/skills/android-build/SKILL.md` for the full workflow — never call `adb` or `gradle` from `Bash`

### `godot`

- Script: `scripts/mcp-servers/godot.mjs`
- Tools: `godot_info`, `godot_create_project`, `godot_list_project`, `godot_validate_project`, `godot_run_gdscript`, `godot_export_project`
- Project scaffolding and inspection work without a Godot binary. Validation, scripted editor tasks, and export require `GODOT_BIN` or `godot`/`godot4` on `PATH`.
- Use the `game-engine-godot` skill for scene/resource/input/export architecture; use `android-builder` for Android device verification.

### `blender`

- Script: `scripts/mcp-servers/blender.mjs`
- Tools: `blender_info`, `blender_run_python`, `blender_create_asset`, `blender_inspect_file`, `blender_render_preview`
- Runtime image installs `blender-headless` and defaults `BLENDER_BIN=blender-headless`.
- Agents can create procedural `.blend`, `.glb`, `.gltf`, `.obj`, `.stl`, or `.fbx` assets with Blender Python and render PNG previews in background mode.

## Auth allowlist

`AUTH_ALLOWED_EMAILS` (comma-separated) is the single source of truth for who can log in:

- Enforced for OAuth (GitHub, Google) via `findOrCreateUser` in `src/auth/passport.ts` — throws `EmailNotAllowedError`, callback redirects to `/connect?error=email_not_allowed`
- Enforced for basic-auth in `src/routes/basic-auth.ts` — returns `403 EMAIL_NOT_ALLOWED`
- Empty = no allowlist (only safe behind a private network or SSO proxy)
- First user matching `SEED_ADMIN_EMAIL` (or the first allowlist entry if unset) gets `role=admin` on first login

## Paths and mounts (container)

- Logos: `LOGOS_DIR=/app/logos` (override file mounts `/mnt/cache/appdata/plum-code-webui/logos`)
- CLI homes (mounted from `${CONFIG_DIR}/<cli>`):
  - Codex → `/home/node/.codex` (primary)
  - OpenCode → `/home/node/.opencode` (with symlinks into `~/.config/opencode` and `~/.local/share/opencode`)
  - Mistral Vibe → `/home/node/.vibe`
  - Claude Code → `/home/node/.claude` (legacy)
  - npm-global → `/home/node/.npm-global`
- Workspace: `${WORKSPACE_DIR}` → `/workspace` (configurable via `ALLOWED_BASE_PATHS`)

## Environment overrides

- `WEBUI_CONFIG_HOME` or `CLAUDE_CONFIG_HOME`: override the shared Claude config home (kept for legacy compatibility)
- `WEBUI_SKILLS_DIRS` or `CLAUDE_SKILLS_DIRS`: extra skill pack folders
- `CLI_PROVIDER_CODEX_MODELS`, `CLI_PROVIDER_OPENCODE_MODELS`, `CLI_PROVIDER_VIBE_MODELS`, `CLI_PROVIDER_CLAUDE_MODELS`: override the model menu per provider (empty = auto-discover for codex/claude, hardcoded fallback for opencode/vibe)
- `CLI_PROVIDER_CODEX_DEFAULT_MODEL` (default `gpt-5.5`), `CLI_PROVIDER_OPENCODE_DEFAULT_MODEL` (default `z-ai/glm-5.1`), `CLI_PROVIDER_VIBE_DEFAULT_MODEL` (default `mistral-vibe-cli-latest`), `CLI_PROVIDER_CLAUDE_DEFAULT_MODEL` (default `sonnet`)
- `CLI_PROVIDER_OPENCODE_DEFAULT_AGENT` (default `build`) and `CLI_PROVIDER_OPENCODE_STYLE_PROMPT` (empty = Codex-like WebUI default; `0`/`false` disables the style prompt)
- `ADMIN_LLM_PROVIDER`: pin the admin/helper LLM choice for commit messages etc. (default order: `codex` → `opencode` → `vibe` → `claude`)
- `OPENCODE_DEBUG_EVENTS=1`: log raw OpenCode events to backend logs

## Rebuild / redeploy protocol (MANDATORY for agents)

When you change Docker- or backend-related code and need a redeploy, **always
write a rebuild trigger and let the `repair-bot` sidecar do the recreate**.
Never call `docker compose build` + `docker compose up -d --force-recreate`
directly from inside the WebUI container — that pattern crashed the deploy
multiple times because the recreate kills the very process making the call.

### The right way

```bash
bash scripts/plum-rebuild.sh
```

That script:

1. Writes `data/rebuild-trigger.json` with `{reason, timestamp, noCache}`.
2. Polls `data/rebuild-robot-status.json` until phase returns to `idle/watching`
   (success) or hits `error` (failure).
3. Runs a sanity curl against `http://localhost:${WEBUI_PORT:-4545}/`.

Flags: `--no-cache` (clean rebuild), `--no-wait` (submit and return), `--timeout=N` (default 600s).

### Why the sidecar architecture is mandatory

The `repair-bot` container (defined in `docker-compose.override.yml`) shares
`/mnt/cache/appdata/plum-code-webui` as `/webui`. Watcher script
`scripts/rebuild-robot-sidecar.sh` polls every 5s, executes
`build → stop → rm -f → up -d --no-deps` against the **main** container from
**outside**, then waits for the health gate. Because the rebuild runs in a
sibling container, the main container can be killed and recreated atomically
without terminating the caller.

Direct `docker compose` calls from inside the main container will repeatedly
leave it in `Created` state on the new image — a human then has to
`docker start <id>` to recover. Just use the trigger.

### Manual fallback (only if `repair-bot` is dead)

If `docker ps --filter name=repair-bot` is empty, `plum-rebuild.sh` exits
with code 3 and tells you to start it: `docker compose up -d repair-bot`.

## Removed paths (do not reintroduce)

The following used to exist in earlier versions of this repo and have been deleted:

- Gemini provider + `~/.gemini` config home + Gemini image generation service
- GLM as a top-level provider (now folded into OpenCode's model routing)
- Orchestration manager + task router + worker pool
- Ralph autonomous loop engine
- Watchdog health monitoring + Telegram alerts
- Self-rebuild HTTP API + handover protocol

(The `repair-bot` sidecar container itself is **still in use** as the rebuild
mechanism — see § Rebuild / redeploy protocol. The OLDER self-rebuild HTTP API
and handover-protocol payloads inside the main container were removed.)

The Rebuild Robot sidecar (`scripts/rebuild-robot-sidecar.sh`, opt-in via `docker-compose.override.yml`) is the only remaining self-rebuild path.

## Known gaps / follow-ups

- Codex usage endpoint requires a valid cookie (`CODEX_USAGE_COOKIE` / `CODEX_USAGE_URL`); otherwise reports unsupported
- MCP tools are bound at CLI spawn — existing sessions won't see new tools until a fresh chat is started
- Custom agents created before the Codex switch may still have `model='claude-sonnet-4-20250514'` (the old default). New agents default to `gpt-5.5`. Users running Claude-flavored agents under Codex sessions will need to edit the model field.
