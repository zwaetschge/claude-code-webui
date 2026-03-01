/** Container-to-container URL resolution for docker-network communication. */

const CONTAINER_NAME = process.env.CONTAINER_NAME || "unknown";

const CONTAINER_URLS: Record<string, string> = {
  "claude-code-webui": "http://claude-code-webui:3001",
  "repair-bot": "http://repair-bot:3001",
};

export function getCurrentContainerName(): string {
  return CONTAINER_NAME;
}

export function getContainerUrl(name: string): string | null {
  return CONTAINER_URLS[name] ?? null;
}

export function getOtherContainerUrl(): string | null {
  for (const [name, url] of Object.entries(CONTAINER_URLS)) {
    if (name !== CONTAINER_NAME) return url;
  }
  return null;
}

export function resolveTargetUrl(target: string): string | null {
  if (target === CONTAINER_NAME) return null; // Can't delegate to self
  return getContainerUrl(target);
}
