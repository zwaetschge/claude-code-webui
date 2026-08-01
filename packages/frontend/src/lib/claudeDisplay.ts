export interface ClaudeDisplayContent {
  message: string;
  providerTools: string[];
  providerToolComplete: boolean;
}

const ZAI_TOOL_HEADER = /(?:^|\n)\s*\*\*(?:🌐\s*)?Z\.ai Built-in Tool:\s*([^*\n]+)\*\*/i;

/**
 * Z.AI's Anthropic-compatible endpoint sometimes mirrors its server-side tool
 * protocol into an assistant text block (including input JSON, signed URLs and
 * escaped result payloads). Claude Code's native terminal understands that
 * envelope, but it is not assistant prose and must not be rendered as such in
 * Plum's structured chat.
 */
export function normalizeClaudeDisplayContent(content: string): ClaudeDisplayContent {
  const match = ZAI_TOOL_HEADER.exec(content);
  if (!match || match.index === undefined) {
    return { message: content, providerTools: [], providerToolComplete: false };
  }

  const toolName = (match[1] || 'Provider tool').trim();
  const providerEnvelope = content.slice(match.index);
  const message = content.slice(0, match.index).trimEnd();

  return {
    message,
    providerTools: [toolName],
    providerToolComplete:
      /\*\*Output:\*\*/i.test(providerEnvelope) || /_result_summary\s*:/i.test(providerEnvelope),
  };
}
