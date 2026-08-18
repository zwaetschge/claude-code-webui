const ANSI_ESCAPE_REGEX =
  /\x1B\[[0-9;]*[a-zA-Z]|\x1B\[\?[0-9;]*[a-zA-Z]|\x1B\[[<>=][^\x1B]*[a-zA-Z]/g;
const URL_REGEX = /(https?:\/\/[^\s"'<>\u001b]+)/i;
const DEVICE_CODE_REGEX = /\b[A-Z0-9]{4}(?:-[A-Z0-9]{4})+\b/;

const CLI_LOGIN_INVOCATIONS = {
  claude: ['auth', 'login'],
  codex: ['login', '--device-auth'],
  opencode: ['auth', 'login'],
  // Kimi Code CLI device-code login: prints the verification URL + user code to
  // stderr and self-polls until the browser authorization completes (exit 0).
  kimi: ['login'],
  // Pi has no CLI-level login: /login is a built-in TUI command, and its own RPC
  // docs state built-in commands "would not execute if sent via prompt". So the
  // TUI is started bare and the command is typed into it (see PI_LOGIN_INPUT).
  pi: [],
} as const;

/**
 * Typed into the PTY once the TUI is up, for providers whose login lives inside
 * an interactive session rather than behind a CLI subcommand.
 */
export const CLI_LOGIN_TUI_INPUT: Partial<Record<string, string>> = {
  pi: '/login antigravity',
};

export function stripCliLoginAnsi(value: string): string {
  return value.replace(ANSI_ESCAPE_REGEX, '');
}

export function extractCliLoginUrl(value: string): string | null {
  const match = stripCliLoginAnsi(value).match(URL_REGEX);
  return match?.[1]?.replace(/[),.;\]}]+$/, '') || null;
}

export function extractCliDeviceCode(value: string): string | null {
  return stripCliLoginAnsi(value).match(DEVICE_CODE_REGEX)?.[0] || null;
}

export function resolveCliLoginInvocation(provider: string): readonly string[] | null {
  return CLI_LOGIN_INVOCATIONS[provider as keyof typeof CLI_LOGIN_INVOCATIONS] || null;
}
