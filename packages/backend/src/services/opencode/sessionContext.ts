export const OPENCODE_WEBUI_SESSION_ARG = 'webui_session_id';

export function buildOpenCodePromptText(text: string, webuiSessionId?: string): string {
  if (!webuiSessionId) return text;
  return [
    '<system-reminder>',
    `Plum WebUI session id: ${webuiSessionId}`,
    `When calling Plum MCP tools, pass ${OPENCODE_WEBUI_SESSION_ARG}="${webuiSessionId}" if the tool schema accepts it.`,
    '</system-reminder>',
    '',
    text,
  ].join('\n');
}
