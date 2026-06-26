# Superpowers Native Provider Integration Design

## Goal

Make the managed `obra/Superpowers` sync feel first-class in Plum Code WebUI instead of relying only on copied skill directories and one prompt injection path.

## Architecture

`superpowersSync.ts` remains the single owner for fetching, marking, and pruning upstream skills. It also prepares native provider registration artifacts where the provider supports them:

- Codex gets a managed local plugin cache entry and enabled plugin config, while keeping the shared `~/.agents/skills -> ~/.claude/skills` path as compatibility fallback.
- OpenCode gets an explicit managed plugin entry pointing at the synced upstream package, while keeping `skills.paths` as a fallback.
- Vibe has no upstream Superpowers plugin, so it continues through `skill_paths` plus the Plum bootstrap context.
- Claude Code continues through native `~/.claude/skills` plus the Plum bootstrap context.

The WebUI-side bootstrap stays in place for all providers because Plum manages sessions itself and cannot assume every CLI will run external startup hooks in the same way. Native provider registration is additive and idempotent.

## Data Flow

1. Startup/session start calls `syncSuperpowers()`.
2. The sync ensures the upstream checkout exists and skill folders are installed into `~/.claude/skills`.
3. Provider registration helpers write only managed config entries:
   - Codex plugin cache and `[plugins."superpowers@plum-managed"]`.
   - OpenCode `plugin` array entry pointing at the synced checkout.
   - Existing OpenCode `skills.paths` and Vibe `skill_paths` remain managed by `providerLinks.ts`.
4. First non-slash user turn receives provider-specific `using-superpowers` bootstrap context once.

## Safety

- User-owned skill folders are not overwritten unless they carry `.plum-superpowers.json`.
- Native provider registration is disabled when `SUPERPOWERS_ENABLED=0`/`false`/`off`.
- Existing user provider config is preserved; only missing managed entries are added.
- No third-party package dependency is introduced.

## Testing

Add a backend script-level regression test for:

- initial sync installs skills and writes markers;
- existing unmarked user skill folders are skipped;
- disabled skill folders are respected;
- Codex managed plugin config/cache is written;
- OpenCode managed plugin entry is written without duplicating user entries;
- provider bootstrap contains the correct provider-specific mapping.
