# AGENTS.md

Notes on the multi-provider integration in Plum Code WebUI.

## Language and Unicode

- In German chat responses, documentation, skill descriptions, memories, and other user-visible text, use real UTF-8 umlauts (`ä`, `ö`, `ü`, including uppercase forms). Do not transliterate them as `ae`, `oe`, or `ue` unless an external format explicitly requires ASCII.
- Keep established technical identifiers, slugs, environment variables, and filenames ASCII when changing them would break compatibility; this exception does not apply to visible prose.
- In Swiss Standard German, use `ss` instead of `ß`. In other German contexts, follow the requested orthography.

## Goals implemented

- **Codex is now the default / primary provider** — Anthropic is restricting `claude -p` / introducing a credit system, so Codex took over as the main horse. Claude stays available as a legacy option.
- Multi-provider harness support (Codex, OpenCode, Pi, Claude Code) with per-session provider selection
- Provider switching inside a session restarts the underlying CLI cleanly
- Streaming + resume simulated for Codex (chunk-level deltas + transcript replay) so the UX is on par with the natively-streaming providers
- Admin/helper LLM calls (commit message generation, etc.) route through `utils/adminLLM.ts` with the same Codex-first preference
- Per-CLI auth + state directories that survive container rebuilds
- Dedicated login routes for every provider: `/auth/codex`, `/auth/opencode`, `/auth/pi`, `/auth/claude`
- Branding: Plum Code WebUI login, provider-specific visuals + logos; Codex shown first, Claude under a "Legacy" label
- ComfyUI MCP server for inline image generation (replaces the earlier Gemini image path)
- Android-builder MCP server for native app workflows on real devices
- Home Assistant physical status lights with one optional `light.*` assignment per session

## Provider summary

| Provider           | CLI        | Process model                                                                                                           | Config home               | Default?    |
| ------------------ | ---------- | ----------------------------------------------------------------------------------------------------------------------- | ------------------------- | ----------- |
| **Codex** (OpenAI) | `codex`    | per-turn — manager respawns on `turn.completed`. Streaming via `*.delta` events; resume via transcript prefix on stdin. | `~/.codex`                | **yes**     |
| OpenCode           | `opencode` | server-backed (HTTP/SSE), full stream-json, native resume; routes 75+ LLMs (GLM `z-ai/glm-*`, Kimi, etc.)               | `~/.local/share/opencode` | no          |
| Pi                 | `pi`       | persistent JSONL RPC; reuses OpenCode API connections/models; shared skills, agents and MCP bridge                      | `~/.pi`                   | no          |
| Kimi Code          | `kimi`     | persistent ACP over stdio; native token/tool streaming, cancel, queued follow-ups, and native session resume             | `~/.kimi-code`            | no          |
| Claude Code        | `claude`   | persistent stream-json — legacy                                                                                         | `~/.claude`               | no (legacy) |

All four harnesses ship inside the container; their config dirs are bind-mounted from `${CONFIG_DIR}` (default `./config`) so OAuth tokens and provider state persist across `docker compose up --build`.

## Provider switching behavior

- Switching provider inside a session restarts the CLI process cleanly
- UI shows provider badges per session in the dashboard and sidebar
- The previous "handover summary" / handoff-protocol injection has been removed — provider switches start a fresh CLI context

## Permission approval behavior

- Permission approvals do not resend the full user prompt
- A short "resume" hint is sent instead, to avoid duplicate responses

## Codex notes (primary)

- Default model: `gpt-5.5` (override with `CLI_PROVIDER_CODEX_DEFAULT_MODEL`)
- Available model menu: hardcoded fallback list; runtime list comes from `~/.codex/models_cache.json` (filtered to `visibility=list`, sorted by priority). Cache refreshes via the codex CLI itself; if the user's auth token is expired, the dropdown freezes on whatever was last fetched. Codex CLI 0.144.0 cache currently lists `gpt-5.5`, then `gpt-5.6-sol`, `gpt-5.6-terra`, `gpt-5.6-luna`.
- Codex reasoning efforts exposed by the UI/backend: `none`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max`, `ultra`. Codex 0.144.0 exposes `ultra` natively for models that support automatic task delegation, including `gpt-5.6-sol` and `gpt-5.6-terra`; preserve it instead of normalizing it to `max`.
- GPT-5.6 WebUI sessions use `agents.max_depth=1` and `agents.max_threads=1` by default for regular efforts, keeping delegation tightly bounded. (Codex CLI 0.144.0+ rejects `max_depth=0`, so 1 is the single-agent floor.) `ultra` and `CODEX_WEBUI_AGENT_MODE=parallel` retain Codex's parallel-agent behaviour; `CODEX_WEBUI_AGENT_MAX_DEPTH` / `CODEX_WEBUI_AGENT_MAX_THREADS` override either policy.
- Streaming is simulated — `translateCodexMessage` in `ClaudeProcessManager` listens for `item.delta`, `agent_message.delta`, `text.delta`, and `response.output_text.delta` events and emits `session:output` deltas. Falls back to full-message emit on `item.completed` if the CLI doesn't send deltas (older versions).
- Resume is simulated — `buildCodexContextPrefix()` reads the last 40 turns (≤24k chars) from SQLite and prepends them as a `[Prior conversation context]` block to stdin on each respawn. Codex CLI has no native `--resume`.
- Per-turn respawn is required: `codex exec` is single-shot. `respawnCodexProcess` creates a fresh child on each user message and reattaches stdout/stderr handlers.

## OpenCode notes

- OpenCode handles GLM, Kimi, and other LLMs through its own model routing — there is no separate GLM provider in the WebUI
- Plum runs one OpenCode server, SSE stream, configuration directory, data directory, and OAuth/account state per WebUI user under `~/.opencode/users/<sha256-user-key>`. Legacy global OpenCode OAuth state is deliberately not assigned to a user; affected users reconnect once through the WebUI.
- Default model: `z-ai/glm-5.1` (override with `CLI_PROVIDER_OPENCODE_DEFAULT_MODEL`)
- Available model menu: empty = auto-discover from the installed CLI (override with `CLI_PROVIDER_OPENCODE_MODELS=…`)
- WebUI defaults OpenCode sessions to the native `build` primary agent (`CLI_PROVIDER_OPENCODE_DEFAULT_AGENT`) and injects a Codex-like communication contract via the managed `build.prompt`; override with `CLI_PROVIDER_OPENCODE_STYLE_PROMPT`, or set it to `0`/`false` to disable
- OpenCode async polling waits up to `OPENCODE_NO_PROGRESS_TIMEOUT_MS` for the first observable assistant output and for later silent stalls after output/tool activity (default `600000`; set `0` to disable the soft cap). On timeout Plum aborts the remote OpenCode turn and marks the WebUI session idle. The separate 30-minute safety cap still stops truly stuck turns.
- Z.AI Vision MCP is managed for OpenCode through `OPENCODE_ZAI_VISION_MCP=auto|always|off` (default `auto`). `auto` enables the `zai-vision` MCP only when the user has an enabled `z-ai`/`zai` provider key; `always` enables it as a Z.AI visual second opinion whenever `Z_AI_API_KEY` is inherited; `off` removes the WebUI-managed entry. The API key must stay in env and must not be written to `opencode.json`.
- Debug stream events with `OPENCODE_DEBUG_EVENTS=1`

## Pi notes

- Pi uses `@earendil-works/pi-coding-agent` in persistent `--mode rpc`; its default model follows OpenCode (`z-ai/glm-5.1`, override with `CLI_PROVIDER_PI_DEFAULT_MODEL`).
- Pi shares the OpenCode provider store. `syncPiConfig()` writes a per-user, secret-free `models.json`; decrypted keys are passed only in the Pi process environment.
- Pi discovers shared skills through `~/.agents/skills`. Claude agent definitions are converted into the official Pi subagent extension's per-user agent directory.
- Pi has no built-in MCP client, so the image pins `pi-mcp-adapter`; the backend mirrors the same Claude-backed MCP registry into each Pi user config.
- Pi requires Node 22.19+; both Docker stages use Node 22.

## Kimi Code notes

- Plum runs one persistent `kimi acp` process per active WebUI session. Do not regress this to `kimi -p`: prompt mode buffers whole model steps and cannot provide normal interactive chat streaming.
- `session/prompt` streams `agent_message_chunk` and tool lifecycle updates into the existing WebUI socket events. Follow-up messages queue while a turn is active; interrupt uses ACP `session/cancel` without killing the session process.
- Native Kimi session ids remain in `sessions.claude_session_id` for resume across WebUI/container restarts. The selected model and Plum permission mode are applied through ACP session config options (`model`, `mode`).

## Claude Code and Z.AI

- `claude` and `zai` are separate session providers even though both use the Claude Code CLI transport.
- Claude sessions use the user's Anthropic subscription/OAuth state. Plum removes inherited `ANTHROPIC_BASE_URL`, `ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_API_KEY`, and model override variables before spawning them.
- Claude's model menu is discovered from the installed Claude Code CLI. Native
  releases are read from their embedded canonical model ID/display-name pairs;
  older JavaScript releases are parsed from `cli.js`. The newest exposed model
  per Fable/Opus/Sonnet/Haiku family is shown. `sonnet` is the stable default
  alias, so a CLI update advances it without a Plum release.
- Settings → General → Z.AI stores a per-user endpoint, API token, and Opus/Sonnet/Haiku model mappings. Routes: `GET/PUT/DELETE /api/settings/zai-api`; the token is encrypted via `ENCRYPTION_KEY` and is never returned in plaintext.
- Only Z.AI sessions receive `ANTHROPIC_BASE_URL`, `ANTHROPIC_AUTH_TOKEN`, optional `ANTHROPIC_DEFAULT_*_MODEL` values, `API_TIMEOUT_MS`, and `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC`.
- The Z.AI preset uses `https://api.z.ai/api/anthropic`, but the base URL remains editable for compatible Z.AI gateways.
- `enabledCliProviders` in per-user settings controls which providers appear for new sessions and provider switching. Existing sessions remain visible.
- The startup migration moves the legacy `claudeApi` override to `zaiApi`, reattributes those users' legacy Claude/GLM sessions to `zai`, and reattributes GLM usage rows without changing real OpenCode usage.

## Admin / helper LLM

`packages/backend/src/utils/adminLLM.ts` provides one-shot text completion for internal WebUI features (commit message generation, future summaries, etc.) — NOT the user's interactive session.

- Order of preference: `codex` → `opencode` → `claude`
- Override via env `ADMIN_LLM_PROVIDER=codex|opencode|claude`
- Used by `routes/git.ts` `/generate-commit-message` (was hardcoded `claude --print -p ...`)
- Each provider runs in its native one-shot mode: `codex exec --skip-git-repo-check --ephemeral <prompt>`, `opencode run <prompt>`, `claude --print -p <prompt>`
- Codex uses `--ephemeral` so admin calls don't pollute `~/.codex/sessions/` and break the resume picker

## Cross-provider usage & analytics

### Token capture into `usage_history`

`ClaudeProcessManager.saveUsageToDatabase` is the single write path for the
analytics page. Every row carries the explicit CLI `provider` and stable WebUI
`turn_id`; `UNIQUE(session_id, provider, turn_id)` plus
`insertUsageHistoryTurn()` makes retries idempotent. It reads from
`proc.turnInputTokens / turnOutputTokens / turnCacheReadTokens /
turnCacheCreationTokens` and skips the insert when the sum is zero. Each
provider feeds those fields differently:

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
- **Pi** — RPC usage is stored with `provider='pi'`, even when its routed model
  id also exists in OpenCode. Do not infer Pi from the model string.

### Per-model pricing (`llm-pricing`)

USD per 1M tokens, per direction, in
`packages/shared/src/types/llm-pricing.ts`. `ClaudeProcessManager` uses the
same shared rate-card as the analytics tab. `usage_history.cost_usd` is a
derived API-equivalent value: startup migrations reprice existing rows when
`LLM_PRICING_RATE_CARD_VERSION` changes. Unknown models must stay unpriced
instead of silently inheriting a fallback.

| Model family              | Input | Output | Cache read | Cache write |
| ------------------------- | ----- | ------ | ---------- | ----------- |
| Claude Fable 5            | 10    | 50     | 1          | 12.5        |
| Claude Opus 4.5+/5        | 5     | 25     | 0.5        | 6.25        |
| Claude Sonnet 5 (to 8/31) | 2     | 10     | 0.2        | 2.5         |
| Claude Sonnet 4           | 3     | 15     | 0.3        | 3.75        |
| Claude Haiku 4.5          | 1     | 5      | 0.1        | 1.25        |
| gpt-5.5                   | 5     | 30     | 0.5        | 0           |
| gpt-5.4                   | 2.5   | 15     | 0.25       | 0           |
| gpt-5.4-mini              | 0.75  | 4.5    | 0.075      | 0           |
| gpt-5.3-codex / 5.2-codex | 1.75  | 14     | 0.175      | 0           |
| opencode-go/qwen3.7-max   | 2.5   | 7.5    | 0.5        | 3.125       |
| opencode-go/mimo-v2.5-pro | 1.74  | 3.48   | 0.0145     | 0           |
| opencode-go/minimax-m3    | 0.3   | 1.2    | 0.06       | 0           |
| Kimi K2.7 Code            | 0.95  | 4      | 0.19       | 0           |
| z-ai/glm-5.2              | 1.4   | 4.4    | 0.26       | 0           |
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

`packages/shared/src/types/cli-providers.ts` exports
`getProviderLabelForUsage(provider, model)` and both backend analytics and
frontend charts must use it. The explicit provider wins; model-only detection
is a legacy fallback for rows created before provider attribution. Fallback
rules:

- `startsWith('gpt-')` OR contains `codex` → Codex
- `startsWith('claude')` OR exact `opus / sonnet / haiku` → Claude
- `startsWith('mistral-')` OR `startsWith('devstral-')` → Vibe (historical analytics rows only; Vibe is no longer a selectable CLI provider)
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

- Runtime-active core skills live in `~/.claude/skills/<name>/SKILL.md`; uncommon workflows and domain packs live in `~/.claude/skill-catalog/<name>/SKILL.md`. Optional design and writing presets live separately under `~/.claude/style-library/{design,writing}` so presentation choices never become global workflow gates.
- Default active core: `api-design`, `capability-catalog`, `debugging-playbook`, `devops-deploy`, `documentation-writer`, `frontend-design`, `performance-tuning`, `refactor-guide`, `security-review`, and `testing-playbook`. The persistent activation state is stored in `~/.claude/integrations/skill-catalog-state.json`.
- Search skills, styles, and agents on demand with `node /app/scripts/capability-catalog.mjs search "<task>"`; load one match with `node /app/scripts/capability-catalog.mjs show <name>`. The authenticated `GET /api/claude-config/skills?library=all` endpoint and Settings → Extensions → Skills expose the same catalog with active/on-demand/style status.
- Enabling a skill moves it into the runtime tree; disabling it moves it back to the on-demand catalog. Design and writing styles remain session-selectable directly from the catalog and do not need global activation.
- `~/.claude/skill-aliases.json` maps consolidated legacy names to canonical entries and records retired names that external folders or `.skill.zip` files must not re-import.
- The first lean-catalog reconciliation migrates legacy `~/.codex/skills` and `~/.codex/agents` entries into the canonical Claude-backed catalog, preserving Codex's `.system` skills. Do not restore duplicate provider-specific copies.
- Agents live in `~/.claude/agents/<name>.md`
- The WebUI auto-syncs external skill packs from these directories (in order):
  - `/mnt/user/AI/Skills` (primary)
  - `/mnt/unraid/AI/Skills` (fallback)
  - `WEBUI_SKILLS_DIRS` (comma-separated overrides)
- `.skill.zip` files are unpacked into the active or on-demand tree according to catalog state; aliases and retired-name tombstones are respected.
- The main WebUI is the only external-skill importer. Set `WEBUI_EXTERNAL_SKILL_SYNC=false` on auxiliary WebUI processes such as `repair-bot`, because they share the persistent config mount and must not race the main catalog reconciliation.
- The managed block in `AGENTS.md` and `CLAUDE.md` is appended/updated on each session — custom text outside the managed block is preserved

### Superpowers (`obra/Superpowers`)

- Superpowers are disabled across Plum Code by default. The backend only syncs the upstream package from `https://github.com/obra/Superpowers` when the whole instance explicitly sets `SUPERPOWERS_ENABLED=true`.
- Defaults: `SUPERPOWERS_ENABLED=false`, `SUPERPOWERS_REPO_URL=https://github.com/obra/Superpowers.git`, `SUPERPOWERS_REF=main`. Setting the switch to `true` opts all providers, users, and workspaces back in; `false` removes Plum-managed skills, disables provider registration, and suppresses bootstrap injection. Refresh/timeout defaults are `SUPERPOWERS_SYNC_INTERVAL_MS=21600000` and `SUPERPOWERS_GIT_TIMEOUT_MS=45000`.
- Existing user skills are not overwritten unless they contain the WebUI Superpowers marker file `.plum-superpowers.json`.
- Provider exposure:
  - Codex: managed local plugin cache/config entry `[plugins."superpowers@plum-managed"]` plus Docker symlink fallback `~/.agents/skills -> ~/.claude/skills`
  - Claude: native `~/.claude/skills`
  - OpenCode: `skills.paths` in `opencode.json`; the upstream Superpowers `plugin` entry is deliberately removed because it injects the blanket `using-superpowers` workflow on every agent step, bypassing Plum's scoped execution policy
  - Pi: native `~/.agents/skills` discovery plus the per-user Pi agent directory generated by `syncPiConfig()`
- `buildSuperpowersBootstrapContext()` injects a compact Plum-controlled skill policy once per WebUI session with provider-specific tool mapping. It deliberately does not paste the upstream `using-superpowers` body, whose blanket skill/brainstorming mandates conflict with autonomous supervisor-mode execution. Do not duplicate this in project `CLAUDE.md`/`AGENTS.md`.
- The session execution contract includes a silent "What would Vale do?" decision proxy for routine or reversible choices. It must resolve decisions internally and must never become another skill, checklist, review, or approval gate.
- Regression: `pnpm --filter @plum-code-webui/backend run test:superpowers` checks sync, skip/disabled handling, Codex native registration, OpenCode upstream-plugin removal, and provider bootstrap mappings.
- CLI sessions export `SUPERPOWERS_DISABLE_TELEMETRY=1` by default, unless explicitly overridden.

### Style preset library

The former 67 design-system skills plus writing/persona packs are curated into 37 design profiles and 32 writing profiles. They remain individually searchable and session-selectable but are not executable workflow skills.

- Locations: `~/.claude/style-library/design/<name>` and `~/.claude/style-library/writing/<name>`
- Consolidated design families retain narrower legacy names as aliases and optional `variants/*.md`; canonical `DESIGN.md` files have explicit contrast-safe surface/text tokens.
- Unsafe or misleading persona rules were replaced with optional voice guidance that never overrides truth, authority, consent, safety, or the requested outcome.
- Run `node scripts/optimize-style-library.mjs <config-home>` after importing an upstream style pack, then `node scripts/validate-skill-catalog.mjs <config-home>`.
- Do not copy style presets back into `~/.claude/skills`; session style selection loads them directly.

## Built-in MCP servers

Claude-backed MCP servers are registered in `config/claude/settings.json` → `mcpServers` and mirrored into Codex, OpenCode, and Pi at startup. Codex also appends a local `oracle` MCP server in `~/.codex/config.toml` for second-opinion consults. Loaded at CLI spawn — only available in **new** sessions.

## Image generation paths

Three parallel paths exist in CLI sessions. Pick by billing + batch size:

| Path              | Trigger                                         | Model                  | Counts against       | Best for                                    |
| ----------------- | ----------------------------------------------- | ---------------------- | -------------------- | ------------------------------------------- |
| Codex `$imagegen` | type `$imagegen ...` (or natural-language hint) | gpt-image-2            | Codex plan limits    | ad-hoc single images in a Codex chat        |
| `openai-image.sh` | `bash /app/scripts/openai-image.sh ...`         | gpt-image-2/1          | OpenAI API (API key) | reproducible asset batches, fixed filenames |
| ComfyUI MCP tools | `generate_image` / `_quality` / `edit_image`    | Z-Image / Flux.2 Klein | local GPU            | offline batch, stylistic control            |

- The shell wrapper `/app/scripts/openai-image.sh` uses only `curl + jq + base64` (no extra CLI install). It accepts `--prompt`, `--output`, `--model`, `--size`, `--quality`, `--n`, `--background`. Subcommands: `generate` and `edit`.
- `OPENAI_API_KEY` is exported into every CLI session via `buildIntegrationEnv()` (source order: `app_config.openai_api_key` → process env). Without it, the script refuses to run.
- The on-demand `image-asset-generation` skill documents the decision tree and exact patterns; the legacy `openai-image-gen` name resolves to it through the catalog alias map.

### `comfyui-images`

The WebUI talks to ComfyUI **directly** — no LoRA Tester sidecar. Workflow definitions, settings, and rate limits live in the backend at `packages/backend/src/services/comfyui/`. The MCP server is a thin bridge over `POST /api/comfyui/internal/generate`.

- Script: `scripts/mcp-servers/comfyui.mjs` (zero-dep Node stdio)
- Tools:
  - `generate_image` — fast T2I via Z-Image Turbo (~5s/image, 9 steps `dpmpp_2m_sde`, qwen3_4b CLIP)
  - `generate_image_quality` — quality T2I via Flux.2 Klein 9B + Turbo LoRA + TeaCache (8 steps `euler`, `SamplerCustomAdvanced`)
  - `edit_image` — image-edit via Flux.2 Klein + ReferenceLatent. Pass an attachment owned by the current user's session (for example under `.claude-webui-attachments/`) or a generated image with owner metadata. `materializeInputImage()` validates ownership, real path, image type, and the 25 MB limit before uploading. Bare ComfyUI filenames are accepted only when the same user uploaded them through Plum during the current process lifetime; arbitrary host paths fail closed.
- Per-call overrides every tool exposes: `prompt`, `negative_prompt`, `seed`, `steps`, `cfg`, `sampler_name`, `aspect_ratio`, `megapixel`. Edit-only: `input_image`. Hidden but supported via the REST endpoint: `unet`, `clip`, `vae`, `lora_name`, `lora_strength`, `teacache_threshold`, `filename_prefix`.
- Auth: MCP inherits `WEBUI_HOOK_SECRET` + `WEBUI_SESSION_ID` from the CLI parent process; sends them as `X-Webui-Hook-Secret` + `X-Webui-Session-Id` headers. Session id resolves to the user for analytics attribution.
- ComfyUI URL: stored in `app_config.comfyui_url`, settable from Settings → Integrations ("Test" button does a `/system_stats` probe). Default fallback chain: app_config → `$COMFYUI_URL` env → `http://192.168.1.23:8188`. Change without restart — the orchestrator re-reads on every job.
- Output: PNG written to `data/generated/<uuid>.png`, served at `/generated/<uuid>.png` (passport session cookie auth). MCP returns `display_markdown` so the agent can paste `![alt](/generated/<uuid>.png)` inline.

### Home Assistant status lights

- Settings → Integrations stores one app-wide Home Assistant URL and encrypted long-lived access token; `HOME_ASSISTANT_URL` / `HOME_ASSISTANT_TOKEN` are optional environment fallbacks.
- Each session may select any available `light.*` entity. Color-capable lights use green/red/blue status colors; non-color lights still pulse on/off or by brightness.
- Goal completion maps to green, blocked goals and session/watchdog errors map to red, and permission/input requests map to a blue heartbeat.
- The backend snapshots and restores the previous light state after every animation. A newer event on the same entity supersedes the active animation without losing that original state.
- Routes live under `/api/home-assistant`; the implementation is in `packages/backend/src/services/home-assistant/`.

### `android-builder`

- Script: `scripts/mcp-servers/android-builder.mjs`
- ~25 tools across project lifecycle, build, install/launch, ADB device management, emulator, on-device testing
- Backend: `http://host.docker.internal:4000` (the `android-app-creator-backend` running on the host)
- Persistent device registry: pair a phone once via `adb_pair_wifi` + `adb_connect_wifi`, the backend stores it in `/app/data/known-devices.json` and auto-reconnects on startup
- Load the on-demand `android-build` skill for the full workflow — never call `adb` or `gradle` from `Bash` when the MCP is available.

### `godot`

- Script: `scripts/mcp-servers/godot.mjs`
- Tools: `godot_info`, `godot_create_project`, `godot_list_project`, `godot_validate_project`, `godot_run_gdscript`, `godot_export_project`
- Project scaffolding and inspection work without a Godot binary. Validation, scripted editor tasks, and export require `GODOT_BIN` or `godot`/`godot4` on `PATH`.
- Use the `game-engines` skill (legacy alias `game-engine-godot`) for scene/resource/input/export architecture; use `android-builder` for Android device verification.

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
  - Pi → `/home/node/.pi` (per-user generated harness config; API connections come from OpenCode settings)
  - Kimi Code → `/home/node/.kimi-code` (OAuth credentials and native session state)
  - Claude Code → `/home/node/.claude` (legacy)
  - npm-global → `/home/node/.npm-global`
- Workspace: `${WORKSPACE_DIR}` → `/workspace` (configurable via `ALLOWED_BASE_PATHS`)

## Environment overrides

- `WEBUI_CONFIG_HOME` or `CLAUDE_CONFIG_HOME`: override the shared Claude config home (kept for legacy compatibility)
- `WEBUI_SKILLS_DIRS` or `CLAUDE_SKILLS_DIRS`: extra skill pack folders
- `CLI_PROVIDER_CODEX_MODELS`, `CLI_PROVIDER_OPENCODE_MODELS`, `CLI_PROVIDER_PI_MODELS`, `CLI_PROVIDER_CLAUDE_MODELS`: optional model-menu overrides. Empty defaults use runtime discovery: Codex cache, OpenCode CLI, OpenCode-backed Pi, and the Claude Code CLI respectively.
- `CLI_PROVIDER_CODEX_DEFAULT_MODEL` (default `gpt-5.5`), `CLI_PROVIDER_OPENCODE_DEFAULT_MODEL` / `CLI_PROVIDER_PI_DEFAULT_MODEL` (default `z-ai/glm-5.1`), `CLI_PROVIDER_CLAUDE_DEFAULT_MODEL` (default stable alias `sonnet`)
- `CLI_PROVIDER_OPENCODE_DEFAULT_AGENT` (default `build`) and `CLI_PROVIDER_OPENCODE_STYLE_PROMPT` (empty = Codex-like WebUI default; `0`/`false` disables the style prompt)
- `ADMIN_LLM_PROVIDER`: pin the admin/helper LLM choice for commit messages etc. (default order: `codex` → `opencode` → `claude`)
- `CODEX_USAGE_TIMEOUT_MS` and `CODEX_USAGE_CACHE_TTL_MS`: bound and singleflight-cache Codex subscription quota requests (defaults: 10 seconds / 60 seconds)
- `OPENCODE_NO_PROGRESS_TIMEOUT_MS`: soft timeout before Plum reports that OpenCode produced no first output (default `600000`; `0` disables this soft cap)
- `OPENCODE_ZAI_VISION_MCP`: Z.AI Vision MCP policy for OpenCode (`auto`, `always`, or `off`; default `auto`)
- `OPENCODE_DEBUG_EVENTS=1`: log raw OpenCode events to backend logs
- `CLI_RUNNER_ACCESS=admin-only|trusted-users`: defaults to `admin-only` while
  CLI processes share one Unix/provider home. Use `trusted-users` only for a
  deliberately trusted private deployment.
- `CLI_RUNNER_ALLOWED_EMAILS`: allow individual non-admin accounts to run CLI
  sessions without widening runner access for every active user.
- `PLUM_BACKUP_RETENTION_DAYS`, `PLUM_LOG_RETENTION_DAYS`, and
  `PLUM_SESSION_RETENTION_DAYS`: retention used by
  `node scripts/plum-maintenance.mjs`; preview with `--dry-run`.

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
`scripts/rebuild-robot-sidecar.sh` polls every 5s, protects the currently
running image, executes `build → stop → rm -f → up -d --no-deps` against the
**main** container from **outside**, then requires `/health/ready`, Docker
health, and the expected candidate image id. A failed candidate is replaced by
the protected image automatically. Because the rebuild runs in a sibling
container, the main container can be killed and recreated atomically without
terminating the caller.

The main WebUI must never mount the raw Docker socket. This trusted-admin site
exposes only the filtered `BUILD`, `IMAGES`, `CONTAINERS`, and `NETWORKS` API
groups through `docker-socket-proxy`, with write methods enabled by the local
`DOCKER_PROXY_CONTAINERS`, `DOCKER_PROXY_IMAGES`, `DOCKER_PROXY_NETWORKS`,
`DOCKER_PROXY_BUILD`, and `DOCKER_PROXY_POST` opt-ins. Compose needs `NETWORKS`
to inspect external networks. Their portable defaults are `0`; `EXEC` and
`VOLUMES` remain disabled. The raw socket belongs exclusively to
`repair-bot` and the proxy. Provider CLIs inherit this filtered `DOCKER_HOST`,
so keep `CLI_RUNNER_ACCESS` admin-only (or explicitly allow only trusted release
operators). Plum's own rebuild must still use `bash scripts/plum-rebuild.sh`.

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

- Codex usage requires a valid Codex CLI OAuth token and ChatGPT account id in `~/.codex/auth.json`; quota requests are cached for 60 seconds and time out after 10 seconds by default.
- MCP tools are bound at CLI spawn — existing sessions won't see new tools until a fresh chat is started
- Custom agents created before the Codex switch may still have `model='claude-sonnet-4-20250514'` (the old default). New agents default to `gpt-5.5`. Users running Claude-flavored agents under Codex sessions will need to edit the model field.
- CLI sessions still share a Unix uid and provider homes. The default
  `CLI_RUNNER_ACCESS=admin-only` is the enforced containment boundary until a
  separate per-user/container runner exists; do not silently change that
  default.
- Preview dev-server vhost cookies are not yet cryptographically bound to a
  WebUI user. Project ownership is checked, but expose preview hosts only
  behind the same authenticated proxy.

## Implemented optimisation baseline

- Production starts the compiled backend with `node dist`, uses pinned Node
  22.22.3/pnpm 9.15.0, production-only backend dependencies, `COPY --chown`,
  and an init process.
- `/health/live` is liveness; `/health/ready` checks SQLite, persistent data,
  config mounts, and the production frontend bundle.
- Browser sessions use the SQLite-backed `http_sessions` store; suspending,
  deleting, or password-resetting a user revokes browser and WebSocket state.
- OpenCode runs in a per-user tenant with separate server process, SSE stream,
  configuration, data and OAuth/account state. Existing global OAuth state is
  not auto-migrated; each affected user reconnects once.
- Startup reconciles stale `running` sessions, child CLIs use process groups,
  and shutdown escalates `SIGTERM` to `SIGKILL` for the complete process tree.
- Codex usage snapshots read at most the last 16 MiB of large rollout JSONL
  files. OpenCode polls only the current turn, serially, with abort and request
  timeouts.
- Settings capability queries are tab-lazy and lists progressively render 6
  agents / 9 skills initially while search still covers the full catalog.
- `node scripts/plum-maintenance.mjs` creates an online SQLite backup, runs
  `quick_check`, uses mode `0600`, and prunes only managed artifacts according
  to configured retention.

<!-- webui-managed: project-context:start -->
# Project: plum-code-webui

Web UI for Codex, OpenCode, Pi, and Claude Code agent harnesses

## Tech Stack
Docker, Docker Compose

**Monorepo** (pnpm)

## Commands
- `pnpm dev` — dev
- `pnpm run build` — build
- `pnpm test` — test
- `pnpm run lint` — lint
- `pnpm run typecheck` — typecheck
- `pnpm start` — start
- `pnpm run format` — format

## Key Directories
packages/, scripts/

Active Core Skills: api-design, capability-catalog, debugging-playbook, devops-deploy, documentation-writer, frontend-design, performance-tuning, refactor-guide, security-review, testing-playbook
On-demand capabilities (83 agents plus the full skill catalog): node /app/scripts/capability-catalog.mjs search "<task>"
<!-- webui-managed: project-context:end -->
