/**
 * Safely parse JSON with a default value fallback
 * Prevents crashes from corrupted database data
 */
export function safeJsonParse<T>(json: string | null | undefined, defaultValue: T): T {
  if (!json) return defaultValue;

  try {
    return JSON.parse(json) as T;
  } catch (error) {
    console.error('Failed to parse JSON:', error, 'Input:', json?.substring(0, 100));
    return defaultValue;
  }
}

/**
 * Safely stringify JSON
 */
export function safeJsonStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch (error) {
    console.error('Failed to stringify JSON:', error);
    return '[]';
  }
}
