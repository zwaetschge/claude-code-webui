# AGENTS.md

Notes from the multi-provider integration work for Plum Code WebUI.

## Goals implemented
- Multi-provider CLI support (Claude, Codex, Z.AI/GLM, Gemini) with per-session provider.
- Provider switching inside a session with a detailed handoff summary (no context-loss surprise).
- Shared settings across providers (default directory, tools list, settings UI).
- Shared skills/agents/plugins across Claude + Codex; GLM and Gemini use their own config homes.
- Branding: Plum Code WebUI login, provider-specific visuals + logos.

## Provider switching behavior
- Switching provider restarts the CLI process and emits a "provider switch handoff" summary.
- Handoff summary is injected as a system reminder on the next prompt.
- Handoff context size increased: 80 messages / 60k chars.
- UI shows provider badges per session in dashboard/sidebar.

## Permission approval behavior
- Permission approvals no longer resend the full user prompt.
- Instead: send a short "resume" hint to avoid duplicate responses.

## Z.AI context-limit handling
- Detects context window limit errors and triggers auto-compact with a detailed handoff summary.
- Clears UI history and injects the handoff on the next prompt so GLM can continue.

## Shared agents / skills / plugins
- Shared config home for Claude + Codex: `~/.claude`.
- GLM uses `~/.glm` (override supported via env).
- Gemini uses `~/.gemini` (override supported via env).
- WebUI auto-syncs external skill packs from:
  - `/mnt/user/AI/Skills` (primary)
  - `/mnt/unraid/AI/Skills` (fallback)
  - `WEBUI_SKILLS_DIRS` (comma-separated overrides)
- `.skill.zip` files are unpacked into `~/.claude/skills`.
- Agents/skills/plugins are exported into `AGENTS.md` and `CLAUDE.md` in each session folder.
- Managed block is appended/updated (does not overwrite custom text).

## Usage meters
- Session usage meters supported for Claude, Z.AI/GLM, Codex.
- Codex usage may require `CODEX_USAGE_COOKIE` / `CODEX_USAGE_URL` env vars.

## Settings
- Default directory is shared across providers.
- Settings tab is provider-agnostic; not tied to UI provider.
- Z.AI settings write to GLM env in `~/.glm/settings.json`:
  - `ANTHROPIC_AUTH_TOKEN`
  - `ANTHROPIC_BASE_URL` (default `https://api.z.ai/api/anthropic`)

## Branding
- Plum branding on login:
  - Logo: `/logos/plum.png`
  - Title: "Plum Code WebUI"
  - Slogan: "A Vibecoded wrapper for Cli-Coding"
- Provider logos:
  - Claude: `/claude-logo.png`
  - Codex: `/logos/codex.webp`
  - Z.AI: `/logos/zai.png`
  - Gemini: `/logos/Gemini_CLI_logo.webp`
- Claude login button stays orange.

## Paths and mounts (container)
- Logos: `LOGOS_DIR=/app/logos` with mount `/mnt/user/appdata/claude-code-webui/logos:/app/logos`
- Config homes:
  - Claude/Codex: `/home/node/.claude` (mounted from `/root/.claude`)
  - GLM: `/home/node/.glm` (mounted from `/root/.glm`)
  - Codex: `/home/node/.codex` (mounted from `/root/.codex`)
  - Gemini: `/home/node/.gemini` (mounted from `/root/.gemini`)
- Allowed base paths: `/mnt/user`

## Environment overrides
- `WEBUI_CONFIG_HOME` or `CLAUDE_CONFIG_HOME`: override shared config home for Claude/Codex.
- `WEBUI_GLM_CONFIG_HOME` or `GLM_CONFIG_HOME`: override GLM config home.
- `WEBUI_GEMINI_CONFIG_HOME` or `GEMINI_CONFIG_HOME`: override Gemini config home.
- `WEBUI_SKILLS_DIRS` or `CLAUDE_SKILLS_DIRS`: extra skill pack folders.
- Codex usage:
  - `CODEX_USAGE_COOKIE`
  - `CODEX_USAGE_URL`
  - `CODEX_USER_AGENT`

## Known gaps / follow-ups
- Codex usage endpoint requires a valid cookie; otherwise returns unsupported.
- Ensure container rebuilt after changes (Dockerfile now installs `unzip` for skill packs).

---

# Multi-CLI Agent Orchestration

This section defines the roles and strengths of each CLI tool in Multi-CLI mode.
When working in a multi-agent session, each tool should be leveraged for its core competencies.

## Agent Roles & Strengths

### Claude Code (Recommended Master)

**Role:** Orchestrator, Planner, Architect

**Icon:** 🟠 | **Provider ID:** `claude`

**Core Strengths:**
- **Planning & Architecture**: Exceptional at breaking down complex tasks into structured plans
- **Orchestration**: Native support for spawning and managing sub-agents via `Task` tool
- **Context Management**: Superior long-context handling with automatic summarization
- **Code Analysis**: Deep understanding of large codebases and cross-file relationships
- **Documentation**: Excellent at generating comprehensive docs, READMEs, and specs

**Best Used For:**
- Project planning and task decomposition
- Architectural decisions and system design
- Coordinating work between slave agents
- Complex refactoring across multiple files
- Writing specifications and documentation
- Code review and quality assessment

**CLI Features:**
- `--resume`: Session persistence and continuation
- `--permission-mode plan`: Dedicated planning mode
- Stream JSON output with partial messages
- Sub-agent spawning with `Task` tool

---

### Codex (OpenAI)

**Role:** Quality Assurance, Hard Implementation

**Icon:** 🟢 | **Provider ID:** `codex`

**Core Strengths:**
- **Precise Coding**: Focused, deterministic code generation
- **Test Writing**: Excellent at comprehensive test coverage
- **Bug Fixing**: Strong at identifying and fixing specific issues
- **Code Quality**: Rigorous adherence to best practices and patterns
- **Reasoning**: Deep reasoning with `o3` and `o4-mini` models

**Best Used For:**
- Implementing well-defined functions and modules
- Writing unit tests and integration tests
- Fixing specific bugs with clear reproduction steps
- Code optimization and performance improvements
- Strict typing and interface definitions
- Security-critical implementations

**CLI Features:**
- `--model o3`: Maximum reasoning capability
- `--reasoning_level`: Configurable thinking depth
- JSON output for structured results
- Sandbox-aware execution

---

### Gemini CLI (Google)

**Role:** Frontend Specialist, UI/UX

**Icon:** 🔵 | **Provider ID:** `gemini`

**Core Strengths:**
- **Frontend Development**: Native understanding of modern web frameworks
- **UI Components**: Excellent at React, Vue, and component architecture
- **Styling**: Strong CSS, Tailwind, and design system knowledge
- **Multi-Modal**: Can process images and visual designs
- **Speed**: Fast responses with `gemini-2.5-flash`

**Best Used For:**
- React/Vue/Svelte component development
- CSS and Tailwind styling
- Responsive design implementation
- UI animations and interactions
- Converting designs to code
- Frontend state management

**CLI Features:**
- `--model gemini-2.5-pro`: Maximum capability
- `--approval-mode auto_edit`: Fast iteration
- Stream JSON for real-time feedback
- Multi-modal input support

---

### Z.AI (GLM)

**Role:** Utility Agent, Quick Tasks

**Icon:** 🔷 | **Provider ID:** `glm`

**Core Strengths:**
- **Fast Execution**: Quick responses for simple tasks
- **Lightweight Tasks**: Efficient for small, focused operations
- **Cost Effective**: Lower resource usage for routine work
- **Claude-Compatible**: Same CLI interface as Claude Code
- **Skill Support**: Access to Claude-style skills and prompts

**Best Used For:**
- Quick file operations and edits
- Simple refactoring tasks
- Generating boilerplate code
- Quick documentation updates
- Routine maintenance tasks
- Rapid prototyping

**CLI Features:**
- `--resume`: Session persistence
- `--allowedTools`: Granular tool control
- Stream JSON output
- Claude-compatible command structure

---

## Multi-CLI Orchestration Patterns

### Pattern 1: Master-Slave Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    MASTER (Claude Code)                      │
│  - Receives user requests                                    │
│  - Plans task decomposition                                  │
│  - Delegates to appropriate slave agents                     │
│  - Aggregates and validates results                          │
└─────────────────────────────────────────────────────────────┘
          │                    │                    │
          ▼                    ▼                    ▼
┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐
│  SLAVE (Codex)  │  │ SLAVE (Gemini)  │  │  SLAVE (Z.AI)   │
│  Backend/Tests  │  │    Frontend     │  │   Quick Tasks   │
└─────────────────┘  └─────────────────┘  └─────────────────┘
```

### Pattern 2: Parallel Execution

When tasks are independent, slaves can work in parallel:

1. **Master** analyzes request and identifies independent subtasks
2. **Master** dispatches to multiple slaves simultaneously
3. **Slaves** execute and return results
4. **Master** aggregates, validates, and presents unified response

### Pattern 3: Sequential Pipeline

For dependent tasks:

1. **Gemini** → Creates UI components
2. **Codex** → Writes tests for components
3. **Claude** → Reviews and integrates
4. **Z.AI** → Cleanup and documentation

---

## Recommended Configurations

### Full-Stack Development
- **Master:** Claude Code (planning + orchestration)
- **Slaves:** Gemini (frontend), Codex (backend + tests)

### Quality-First Development
- **Master:** Codex (strict quality gates)
- **Slaves:** Claude (implementation), Z.AI (boilerplate)

### Rapid Prototyping
- **Master:** Claude Code (architecture)
- **Slaves:** Gemini (UI), Z.AI (quick iterations)

### Test-Driven Development
- **Master:** Codex (tests first)
- **Slaves:** Claude (implementation), Gemini (UI tests)

---

## Multi-CLI Session Configuration

```json
{
  "mode": "multi",
  "master": "claude",
  "slaves": ["codex", "gemini", "glm"],
  "routing": {
    "frontend": "gemini",
    "backend": "codex",
    "tests": "codex",
    "docs": "claude",
    "quick": "glm"
  }
}
```

---

## Best Practices

1. **Let the Master Plan**: Always route initial requests through the master agent for proper task decomposition.

2. **Match Task to Agent**: Use each agent for its core strengths. Don't send frontend work to Codex or complex architecture to Z.AI.

3. **Validate with Codex**: When quality is critical, have Codex review or test the output from other agents.

4. **Document with Claude**: For comprehensive documentation, Claude Code produces the most thorough results.

5. **Iterate with Z.AI**: For quick iterations and small fixes, Z.AI provides fast turnaround.

6. **Multi-Modal with Gemini**: When working with images, designs, or visual content, leverage Gemini's multi-modal capabilities.

---
