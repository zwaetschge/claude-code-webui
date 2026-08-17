import type { Message, MessageHistorySnapshot } from '@plum-code-webui/shared';

export function normalizeMessageChatId(
  chatId: string | null | undefined
): string | null | undefined {
  return chatId === 'main' ? null : chatId;
}

export function messageBelongsToChat(message: Message, chatId: string | null): boolean {
  return normalizeMessageChatId(message.chatId) === normalizeMessageChatId(chatId);
}

/**
 * Keep a UI history transition atomic: callers only mutate the visible store
 * after the complete request succeeds. A rejected request leaves the previous
 * conversation and cursor untouched.
 */
export async function loadThenCommit<T>(
  load: () => Promise<T>,
  commit: (value: T) => void
): Promise<T> {
  const value = await load();
  commit(value);
  return value;
}

function messageTimestamp(message: Message): number {
  const timestamp = Date.parse(message.createdAt);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

/**
 * Reconcile a coherent REST snapshot with messages that may have arrived over
 * the socket while the request was in flight. Stable ids win first, followed
 * by clientMessageId so an optimistic delivery is replaced by its persisted
 * counterpart instead of being rendered twice.
 */
export function mergeMessageHistorySnapshot(
  snapshotMessages: Message[],
  liveMessages: Message[]
): Message[] {
  const merged = snapshotMessages.map((message) => ({ ...message }));
  const indexById = new Map<string, number>();
  const indexByClientId = new Map<string, number>();

  const indexMessage = (message: Message, index: number) => {
    indexById.set(message.id, index);
    if (message.clientMessageId) indexByClientId.set(message.clientMessageId, index);
  };

  merged.forEach(indexMessage);

  for (const liveMessage of liveMessages) {
    const matchIndex =
      indexById.get(liveMessage.id) ??
      (liveMessage.clientMessageId ? indexByClientId.get(liveMessage.clientMessageId) : undefined);

    if (matchIndex === undefined) {
      const nextIndex = merged.length;
      merged.push({ ...liveMessage });
      indexMessage(liveMessage, nextIndex);
      continue;
    }

    const snapshotMessage = merged[matchIndex];
    if (!snapshotMessage) {
      const nextIndex = merged.length;
      merged.push({ ...liveMessage });
      indexMessage(liveMessage, nextIndex);
      continue;
    }
    const reconciled: Message = {
      ...liveMessage,
      ...snapshotMessage,
      id: snapshotMessage.id,
      clientMessageId: snapshotMessage.clientMessageId ?? liveMessage.clientMessageId,
      media: snapshotMessage.media ?? liveMessage.media,
      attachments: snapshotMessage.attachments ?? liveMessage.attachments,
      images: snapshotMessage.images ?? liveMessage.images,
      eventSequence:
        Math.max(snapshotMessage.eventSequence ?? 0, liveMessage.eventSequence ?? 0) || undefined,
    };
    merged[matchIndex] = reconciled;
    indexMessage(reconciled, matchIndex);
  }

  return merged.sort((left, right) => {
    const timeDelta = messageTimestamp(left) - messageTimestamp(right);
    if (timeDelta !== 0) return timeDelta;
    const sequenceDelta = (left.eventSequence ?? 0) - (right.eventSequence ?? 0);
    if (sequenceDelta !== 0) return sequenceDelta;
    return left.id.localeCompare(right.id);
  });
}

export function isMessageSnapshotStale(
  incoming: MessageHistorySnapshot | undefined,
  current: MessageHistorySnapshot | undefined,
  socketHighWatermark: number
): boolean {
  if (!incoming) return socketHighWatermark > 0;
  if (incoming.highWatermark < socketHighWatermark) return true;
  if (!current || incoming.chatId !== current.chatId) return false;
  return incoming.revision < current.revision;
}

export function advanceMessageCursor(current: number, incoming: number): number {
  if (!Number.isFinite(incoming) || incoming <= 0) return Math.max(0, current);
  return Math.max(current, incoming);
}
