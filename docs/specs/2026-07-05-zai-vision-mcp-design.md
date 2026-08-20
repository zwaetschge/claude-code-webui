# Z.AI Vision MCP Design

## Goal

Add a WebUI-managed OpenCode MCP entry for Z.AI's Visual Understanding MCP so GLM Coding Plan sessions can use image and video understanding tools.

## Sources

- Z.AI docs index: `https://docs.z.ai/llms.txt`
- Z.AI Vision MCP page: `https://docs.z.ai/devpack/mcp/vision-mcp-server`
- npm package metadata checked on 2026-07-05: `@z_ai/mcp-server@0.1.4`, package `engines.node >=18.0.0`

## Requirements

- Use `@z_ai/mcp-server@latest` through `npx -y` so cached older versions are not reused.
- Provide `Z_AI_MODE=ZAI`.
- Do not persist the user's Z.AI API key into `opencode.json`.
- Reuse the existing encrypted OpenCode provider key flow; the OpenCode server process already receives `Z_AI_API_KEY` for enabled `z-ai`/`zai` providers.
- Add policy control:
  - `auto`: default; manage the MCP entry only when the user has an enabled `z-ai` or `zai` OpenCode provider with an API key.
  - `always`: manage the MCP entry whenever an inherited `Z_AI_API_KEY` is available, so it can be used as a second-opinion vision MCP for other OpenCode models.
  - `off`: do not manage the MCP entry.
- Preserve user-owned MCP entries with different names.
- If WebUI owns the `zai-vision` entry and policy becomes inactive, disable or remove that managed entry instead of leaving a stale active tool.

## Design

Add helper functions in `providerLinks.ts` to resolve the policy and produce a managed OpenCode MCP config entry. The managed entry will be named `zai-vision` and marked with a metadata field so future syncs can update or remove only WebUI-owned state.

The managed MCP command should be local:

```json
{
  "type": "local",
  "command": ["npx", "-y", "@z_ai/mcp-server@latest"],
  "environment": {
    "Z_AI_MODE": "ZAI"
  },
  "enabled": true,
  "webuiManaged": "zai-vision-v1"
}
```

`Z_AI_API_KEY` is intentionally omitted from `opencode.json`. OpenCode's MCP child process should inherit it from the OpenCode server process env, which WebUI already builds from encrypted provider settings.

Expose the policy through `OPENCODE_ZAI_VISION_MCP=auto|always|off`, defaulting to `auto`. Add the variable to Docker Compose and document it in `AGENTS.md`.

## Testing

Extend `provider-regression-tests.ts` with RED/GREEN coverage for:

- `auto` adds `zai-vision` when enabled `z-ai` provider has a key.
- `auto` does not add it without a Z.AI key.
- `always` adds it from inherited env availability without writing the key.
- `off` removes a previously managed entry.
- Existing user-owned `zai-vision` without the WebUI marker is preserved.

## Notes

Z.AI docs state Node.js >=22 as a troubleshooting prerequisite, but npm package metadata currently declares Node >=18. The current Docker image uses Node 20. Keep Node unchanged unless runtime verification proves the package fails under Node 20.
