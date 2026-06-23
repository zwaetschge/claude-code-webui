const TITLE_LIMIT = 120;
const SUMMARY_LIMIT = 1500;
const FIELD_LIMIT = 700;
const METADATA_LIMIT = 16_000;

function truncate(value: string, limit: number): string {
  if (value.length <= limit) return value;
  return `${value.slice(0, Math.max(0, limit - 15)).trimEnd()}...[truncated]`;
}

export function redactDiscordText(value: unknown, limit = SUMMARY_LIMIT): string {
  const raw = typeof value === 'string' ? value : JSON.stringify(value ?? '');
  const text = raw
    .replace(/\b(Authorization:\s*Bearer\s+)[^\s"'`,;]+/gi, '$1[REDACTED]')
    .replace(/\b(Bearer\s+)[A-Za-z0-9._~+/=-]{16,}/gi, '$1[REDACTED]')
    .replace(
      /\b(token|api[_-]?key|password|passwd|secret|cookie)\s*[:=]\s*("[^"]*"|'[^']*'|[^\s,;]+)/gi,
      '$1=[REDACTED]'
    )
    .replace(/(https?:\/\/)([^@\s/:]+):([^@\s/]+)@/gi, '$1[REDACTED]@')
    .replace(
      /https:\/\/(?:canary\.|ptb\.)?discord(?:app)?\.com\/api\/webhooks\/(\d+)\/[A-Za-z0-9._-]+/gi,
      'https://discord.com/api/webhooks/$1/[REDACTED]'
    );

  return truncate(text, limit);
}

export function redactDiscordTitle(value: unknown): string {
  return redactDiscordText(value, TITLE_LIMIT);
}

export function redactDiscordField(value: unknown): string {
  return redactDiscordText(value, FIELD_LIMIT);
}

export function redactDiscordMetadata(value: unknown): string {
  return redactDiscordText(value, METADATA_LIMIT);
}
