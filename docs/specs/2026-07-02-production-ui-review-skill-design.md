# Production UI Review Skill Design

## Goal

Fold the useful parts of Layr's UI-quality approach into Plum Code WebUI without turning it into global prompt bulk.

## Design

Add a Plum-managed skill named `production-ui-review`. The skill is activated for frontend, product UI, onboarding, dashboard, form, checkout, pricing, landing page, and AI-feature work. It acts as a production-quality review and improvement pass: identify the surface, inspect evidence, score with caps, fix the highest-leverage issues, then verify again.

The skill must be original Plum guidance, not a vendored copy of Layr files. It should capture the useful pattern: surface-specific checks, evidence over taste, hard caps for missing verification, and an improvement loop toward a production bar.

## Boundaries

- Do not inject the full checklist into every session.
- Do not apply the skill to backend, infra, provider, or database work unless the task includes user-facing UI.
- Do not overwrite a user-owned skill with the same name.
- Do not recreate the skill when the user disables it.

## Integration

Install the managed skill into `~/.claude/skills/production-ui-review` through backend skill sync. Codex, Claude, OpenCode, and Vibe already discover shared skills through the existing shared skills path, so no provider-specific implementation is needed beyond the normal registry/bootstrap text.

## Verification

Regression tests should cover installation, user-owned skip behavior, disabled-skill skip behavior, and normal skill-library listing.
