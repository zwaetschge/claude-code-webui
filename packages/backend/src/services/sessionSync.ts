import type { MessageHistorySnapshot, SessionReadState } from '@plum-code-webui/shared';
import type Database from 'better-sqlite3';

import { getDatabase } from '../db/index.js';

interface SessionSyncRow {
  activeChatId: string | null;
  eventSequence: number;
  snapshotRevision: number;
}

const EVENT_SEQUENCE_BLOCK_SIZE = 256;
const sequenceBlocks = new Map<string, { next: number; end: number; lastIssued: number }>();

function syncDatabase(database?: Database.Database): Database.Database {
  return database ?? getDatabase();
}

export function nextSessionEventSequence(sessionId: string, database?: Database.Database): number {
  const db = syncDatabase(database);
  const existing = sequenceBlocks.get(sessionId);
  if (existing && existing.next <= existing.end) {
    const sequence = existing.next++;
    existing.lastIssued = sequence;
    return sequence;
  }

  const reserved = db.transaction(() => {
    const updated = db
      .prepare(
        `UPDATE sessions
            SET event_sequence = event_sequence + ?
          WHERE id = ?
          RETURNING event_sequence AS sequence`
      )
      .get(EVENT_SEQUENCE_BLOCK_SIZE, sessionId) as { sequence: number } | undefined;
    if (!updated) throw new Error('Session not found');
    return {
      start: updated.sequence - EVENT_SEQUENCE_BLOCK_SIZE + 1,
      end: updated.sequence,
    };
  })();
  sequenceBlocks.set(sessionId, {
    next: reserved.start + 1,
    end: reserved.end,
    lastIssued: reserved.start,
  });
  return reserved.start;
}

/**
 * The persisted value is the end of the currently reserved block. While this
 * process is alive, report the last actually issued sequence. After restart a
 * reserved-but-unused gap is intentionally visible and forces a safe REST
 * resync instead of risking an undetected missing event.
 */
export function getSessionEventHighWatermark(
  sessionId: string,
  persistedHighWatermark: number
): number {
  return sequenceBlocks.get(sessionId)?.lastIssued ?? persistedHighWatermark;
}

export function resetSessionSequenceAllocatorForTests(): void {
  sequenceBlocks.clear();
}

export function getSessionSyncState(
  sessionId: string,
  userId?: string,
  database?: Database.Database
): { highWatermark: number; snapshotRevision: number; activeChatId: string | null } {
  const db = syncDatabase(database);
  const row = db
    .prepare(
      `SELECT active_chat_id AS activeChatId,
              event_sequence AS eventSequence,
              snapshot_revision AS snapshotRevision
         FROM sessions
        WHERE id = ?${userId ? ' AND user_id = ?' : ''}`
    )
    .get(...(userId ? [sessionId, userId] : [sessionId])) as SessionSyncRow | undefined;
  if (!row) throw new Error('Session not found');
  return {
    highWatermark: getSessionEventHighWatermark(sessionId, row.eventSequence),
    snapshotRevision: row.snapshotRevision,
    activeChatId: row.activeChatId,
  };
}

/**
 * Resolve a send target once, before any attachment reads or message writes.
 * Explicit targets must belong to the session; legacy callers may omit chatId
 * and inherit the active thread. The process layer separately verifies that a
 * new provider turn is bound to this chat, while durable retries may still
 * retrieve an already-finished ACK after another device switches threads.
 */
export function resolveSessionSendChatId(
  sessionId: string,
  userId: string,
  requestedChatId?: string | null,
  database?: Database.Database
): string | null {
  const db = syncDatabase(database);
  const session = db
    .prepare(`SELECT active_chat_id AS activeChatId FROM sessions WHERE id = ? AND user_id = ?`)
    .get(sessionId, userId) as { activeChatId: string | null } | undefined;
  if (!session) throw new Error('Session not found');

  if (requestedChatId === undefined) return session.activeChatId;
  if (
    requestedChatId !== null &&
    !db
      .prepare(`SELECT 1 FROM session_chats WHERE id = ? AND session_id = ?`)
      .get(requestedChatId, sessionId)
  ) {
    throw new Error('Chat not found in this session');
  }
  return requestedChatId;
}

export function getMessageHistorySnapshot(
  sessionId: string,
  userId: string,
  chatId?: string | null,
  database?: Database.Database
): MessageHistorySnapshot {
  const db = syncDatabase(database);
  const state = getSessionSyncState(sessionId, userId, db);
  const effectiveChatId = chatId === undefined ? state.activeChatId : chatId;
  if (
    effectiveChatId !== null &&
    !db
      .prepare(`SELECT 1 FROM session_chats WHERE id = ? AND session_id = ?`)
      .get(effectiveChatId, sessionId)
  ) {
    throw new Error('Chat not found');
  }
  const newest = db
    .prepare(
      `SELECT id
         FROM messages
        WHERE session_id = ? AND chat_id IS ?
        ORDER BY rowid DESC
        LIMIT 1`
    )
    .get(sessionId, effectiveChatId) as { id: string } | undefined;
  return {
    chatId: effectiveChatId,
    revision: state.snapshotRevision,
    highWatermark: state.highWatermark,
    newestMessageId: newest?.id ?? null,
  };
}

export function getSessionReadState(
  userId: string,
  sessionId: string,
  chatId?: string | null,
  database?: Database.Database
): SessionReadState {
  const db = syncDatabase(database);
  const state = getSessionSyncState(sessionId, userId, db);
  const effectiveChatId = chatId === undefined ? state.activeChatId : chatId;
  if (
    effectiveChatId !== null &&
    !db
      .prepare(`SELECT 1 FROM session_chats WHERE id = ? AND session_id = ?`)
      .get(effectiveChatId, sessionId)
  ) {
    throw new Error('Chat not found');
  }
  const chatKey = effectiveChatId ?? '';
  const read = db
    .prepare(
      `SELECT last_read_message_id AS lastReadMessageId, updated_at AS updatedAt
         FROM session_reads
        WHERE user_id = ? AND session_id = ? AND chat_key = ?`
    )
    .get(userId, sessionId, chatKey) as
    | { lastReadMessageId: string | null; updatedAt: string }
    | undefined;
  const marker = read?.lastReadMessageId
    ? (db
        .prepare(`SELECT rowid FROM messages WHERE id = ? AND session_id = ?`)
        .get(read.lastReadMessageId, sessionId) as { rowid: number } | undefined)
    : undefined;
  const unread = db
    .prepare(
      `SELECT COUNT(*) AS count
         FROM messages
        WHERE session_id = ? AND chat_id IS ? AND role = 'assistant'
          AND rowid > ?`
    )
    .get(sessionId, effectiveChatId, marker?.rowid ?? 0) as { count: number };
  return {
    sessionId,
    chatId: effectiveChatId,
    lastReadMessageId: read?.lastReadMessageId ?? null,
    unreadCount: unread.count,
    updatedAt: read?.updatedAt ?? null,
  };
}

export function setSessionReadState(
  userId: string,
  sessionId: string,
  input: { chatId?: string | null; lastReadMessageId?: string | null },
  database?: Database.Database
): SessionReadState {
  const db = syncDatabase(database);
  const state = getSessionSyncState(sessionId, userId, db);
  const effectiveChatId = input.chatId === undefined ? state.activeChatId : input.chatId;
  if (
    effectiveChatId !== null &&
    !db
      .prepare(`SELECT 1 FROM session_chats WHERE id = ? AND session_id = ?`)
      .get(effectiveChatId, sessionId)
  ) {
    throw new Error('Chat not found');
  }
  let messageId = input.lastReadMessageId ?? null;
  if (messageId) {
    const message = db
      .prepare(`SELECT id FROM messages WHERE id = ? AND session_id = ? AND chat_id IS ?`)
      .get(messageId, sessionId, effectiveChatId);
    if (!message) throw new Error('Read marker message does not belong to this chat');
  } else if (input.lastReadMessageId === undefined) {
    const newest = db
      .prepare(
        `SELECT id FROM messages
          WHERE session_id = ? AND chat_id IS ?
          ORDER BY rowid DESC LIMIT 1`
      )
      .get(sessionId, effectiveChatId) as { id: string } | undefined;
    messageId = newest?.id ?? null;
  }
  db.prepare(
    `INSERT INTO session_reads (
       user_id, session_id, chat_key, last_read_message_id, updated_at
     ) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(user_id, session_id, chat_key) DO UPDATE SET
       last_read_message_id = excluded.last_read_message_id,
       updated_at = CURRENT_TIMESTAMP`
  ).run(userId, sessionId, effectiveChatId ?? '', messageId);
  return getSessionReadState(userId, sessionId, effectiveChatId, db);
}
