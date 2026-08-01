export const AGENT_INITIAL_COUNT = 6;
export const AGENT_PAGE_SIZE = 18;
export const CAPABILITY_INITIAL_COUNT = 9;
export const CAPABILITY_PAGE_SIZE = 24;

export function getVisibleItems<T>(items: readonly T[], visibleCount: number): T[] {
  const boundedCount = Math.max(0, Math.floor(visibleCount));
  return items.slice(0, boundedCount);
}

export function getNextVisibleCount(current: number, total: number, pageSize: number): number {
  const boundedTotal = Math.max(0, Math.floor(total));
  const boundedPage = Math.max(1, Math.floor(pageSize));
  return Math.min(boundedTotal, Math.max(0, Math.floor(current)) + boundedPage);
}
