import assert from 'node:assert/strict';
import type { Message, MessageHistorySnapshot } from '@plum-code-webui/shared';
import {
  advanceMessageCursor,
  isMessageSnapshotStale,
  loadThenCommit,
  messageBelongsToChat,
  mergeMessageHistorySnapshot,
} from '../src/lib/messageHistory.js';

const message = (overrides: Partial<Message> & Pick<Message, 'id'>): Message => ({
  sessionId: 'session-1',
  role: 'assistant',
  content: overrides.id,
  createdAt: '2026-08-09T10:00:00.000Z',
  ...overrides,
});

const snapshotRow = message({ id: 'persisted-1', eventSequence: 10 });
const socketDuringFetch = message({
  id: 'socket-2',
  eventSequence: 11,
  createdAt: '2026-08-09T10:00:01.000Z',
});
assert.deepEqual(
  mergeMessageHistorySnapshot([snapshotRow], [snapshotRow, socketDuringFetch]).map((row) => row.id),
  ['persisted-1', 'socket-2'],
  'a socket message received during REST must survive reconciliation'
);

const optimistic = message({
  id: 'optimistic-local',
  clientMessageId: 'client-1',
  role: 'user',
  content: 'optimistic',
});
const persisted = message({
  id: 'persisted-server',
  clientMessageId: 'client-1',
  role: 'user',
  content: 'persisted',
});
const clientReconciled = mergeMessageHistorySnapshot([persisted], [optimistic]);
assert.equal(clientReconciled.length, 1, 'clientMessageId should deduplicate optimistic delivery');
assert.equal(clientReconciled[0]?.id, 'persisted-server', 'the canonical server id should win');
assert.equal(clientReconciled[0]?.content, 'persisted', 'persisted content should win');

const sameId = mergeMessageHistorySnapshot(
  [message({ id: 'same-id', eventSequence: 8 })],
  [message({ id: 'same-id', eventSequence: 9 })]
);
assert.equal(sameId.length, 1, 'stable message ids must not duplicate');
assert.equal(sameId[0]?.eventSequence, 9, 'the newest event sequence should be retained');

const current: MessageHistorySnapshot = {
  chatId: 'chat-a',
  revision: 5,
  highWatermark: 12,
  newestMessageId: 'socket-2',
};
assert.equal(
  isMessageSnapshotStale({ ...current, highWatermark: 10 }, current, 12),
  true,
  'a snapshot behind the socket cursor is stale'
);
assert.equal(
  isMessageSnapshotStale({ ...current, revision: 4 }, current, 12),
  true,
  'an older revision in the same chat is stale'
);
assert.equal(
  isMessageSnapshotStale({ ...current, chatId: 'chat-b', revision: 1 }, current, 12),
  false,
  'a newly activated chat starts its own snapshot lineage'
);

assert.equal(advanceMessageCursor(15, 9), 15, 'a reconnect cursor must never move backwards');
assert.equal(advanceMessageCursor(15, 18), 18, 'a newer cursor should advance');

let reconnectCursor = 7;
await assert.rejects(
  loadThenCommit(
    async () => {
      throw new Error('snapshot unavailable');
    },
    (snapshot: { highWatermark: number }) => {
      reconnectCursor = snapshot.highWatermark;
    }
  ),
  /snapshot unavailable/
);
assert.equal(reconnectCursor, 7, 'a failed full resync must leave the reconnect cursor unchanged');

let visibleSearchWindow = ['previous-1', 'previous-2'];
await assert.rejects(
  loadThenCommit(
    async () => {
      throw new Error('around window unavailable');
    },
    (rows: string[]) => {
      visibleSearchWindow = rows;
    }
  ),
  /around window unavailable/
);
assert.deepEqual(
  visibleSearchWindow,
  ['previous-1', 'previous-2'],
  'a failed around jump must preserve the previously visible conversation'
);

await loadThenCommit(
  async () => ['latest-1'],
  (rows) => {
    visibleSearchWindow = rows;
  }
);
assert.deepEqual(
  visibleSearchWindow,
  ['latest-1'],
  'a successful latest restore commits atomically'
);

assert.equal(
  messageBelongsToChat(message({ id: 'main-row', chatId: null }), null),
  true,
  'the implicit main chat should match null'
);
assert.equal(
  messageBelongsToChat(message({ id: 'foreign-row', chatId: 'chat-b' }), 'chat-a'),
  false,
  'messages from another chat must not enter the visible history'
);

console.log('Message history merge tests passed.');
