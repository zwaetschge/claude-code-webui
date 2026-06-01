export const CODEX_SANDBOX_MODES = ['read-only', 'workspace-write', 'danger-full-access'] as const;
export const CODEX_APPROVAL_POLICIES = ['untrusted', 'on-failure', 'on-request', 'never'] as const;

export type CodexSandboxMode = (typeof CODEX_SANDBOX_MODES)[number];
export type CodexApprovalPolicy = (typeof CODEX_APPROVAL_POLICIES)[number];

function pickEnvValue<T extends readonly string[]>(
  value: string | undefined,
  allowed: T
): T[number] | null {
  const normalized = value?.trim();
  if (!normalized) return null;
  return (allowed as readonly string[]).includes(normalized) ? (normalized as T[number]) : null;
}

export function getCodexWebuiSandboxMode(env: NodeJS.ProcessEnv = process.env): CodexSandboxMode {
  return (
    pickEnvValue(env.CODEX_WEBUI_SANDBOX_MODE, CODEX_SANDBOX_MODES) ??
    (env.CONTAINER_NAME ? 'danger-full-access' : 'workspace-write')
  );
}

export function getCodexWebuiApprovalPolicy(
  env: NodeJS.ProcessEnv = process.env
): CodexApprovalPolicy {
  return (
    pickEnvValue(env.CODEX_WEBUI_APPROVAL_POLICY, CODEX_APPROVAL_POLICIES) ??
    (env.CONTAINER_NAME ? 'never' : 'on-request')
  );
}
