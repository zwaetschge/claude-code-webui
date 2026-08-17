import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'plum-durable-chat-'));
process.env.NODE_ENV = 'test';
process.env.WEBUI_DATA_DIR = temporaryDirectory;
process.env.CHAT_UPLOAD_DIR = path.join(temporaryDirectory, 'chat-uploads');
process.env.ENCRYPTION_KEY = 'durable-chat-regression-encryption-key-000';
process.env.WEBUI_SUPPRESS_BOOTSTRAP_CREDENTIAL_LOG = '1';
process.env.WEBUI_EXTERNAL_SKILL_SYNC = 'false';

const { initDatabase } = await import('../src/db/index.js');
const { claimMessageDelivery, finishMessageDelivery, hashDeliveryPayload } =
  await import('../src/services/messageDelivery.js');
const {
  getMessageHistorySnapshot,
  getSessionReadState,
  getSessionSyncState,
  nextSessionEventSequence,
  resolveSessionSendChatId,
  resetSessionSequenceAllocatorForTests,
  setSessionReadState,
} = await import('../src/services/sessionSync.js');
const {
  cancelChatUpload,
  ChatUploadError,
  cleanupExpiredChatUploads,
  createChatUpload,
  getChatUpload,
  markChatUploadsConsumed,
  putChatUploadChunk,
  releaseChatUploadReservations,
  resolveChatUploads,
} = await import('../src/services/chatUploads.js');
const { buildFtsMatch, escapeMessageSearchLike, sessionUnreadCountSelect } =
  await import('../src/routes/sessions.js');

const database = initDatabase();
for (const [id, email] of [
  ['owner', 'owner@example.test'],
  ['foreign', 'foreign@example.test'],
] as const) {
  database
    .prepare(
      `INSERT INTO users (id, email, name, provider, provider_id, role, status)
       VALUES (?, ?, ?, 'basic', ?, 'admin', 'active')`
    )
    .run(id, email, id, id);
}
database
  .prepare(
    `INSERT INTO sessions (id, user_id, name, working_directory, status)
     VALUES ('delivery-session', 'owner', 'Delivery', '/tmp', 'stopped'),
            ('sync-session', 'owner', 'Sync', '/tmp', 'stopped'),
            ('foreign-session', 'foreign', 'Foreign', '/tmp', 'stopped')`
  )
  .run();

database
  .prepare(
    `INSERT INTO session_chats (id, session_id, title)
     VALUES ('chat-a', 'delivery-session', 'A'),
            ('chat-b', 'delivery-session', 'B'),
            ('foreign-chat', 'foreign-session', 'Foreign')`
  )
  .run();
database
  .prepare(`UPDATE sessions SET active_chat_id = 'chat-a' WHERE id = 'delivery-session'`)
  .run();

// Explicit sends stay bound to their intended owned chat. A stale outbox send
// after another device switches threads is rejected instead of leaking into B.
assert.equal(resolveSessionSendChatId('delivery-session', 'owner', 'chat-a', database), 'chat-a');
assert.throws(
  () => resolveSessionSendChatId('delivery-session', 'owner', 'foreign-chat', database),
  /Chat not found in this session/
);
database
  .prepare(`UPDATE sessions SET active_chat_id = 'chat-b' WHERE id = 'delivery-session'`)
  .run();
assert.equal(
  resolveSessionSendChatId('delivery-session', 'owner', 'chat-a', database),
  'chat-a',
  'an explicit outbox target remains pinned even after another device switches active chat'
);
assert.equal(resolveSessionSendChatId('delivery-session', 'owner', undefined, database), 'chat-b');
database
  .prepare(`UPDATE sessions SET active_chat_id = 'chat-a' WHERE id = 'delivery-session'`)
  .run();

// Persistent delivery receipts return the exact terminal ACK and reject reuse
// of the same id for a different semantic payload.
const payloadHash = hashDeliveryPayload({
  sessionId: 'delivery-session',
  message: 'hello',
  activeFollowupMode: 'queue',
});
assert.equal(
  claimMessageDelivery('owner', 'delivery-session', 'delivery-1', payloadHash, database).kind,
  'claimed'
);
const accepted = {
  clientMessageId: 'delivery-1',
  status: 'accepted' as const,
  acceptedAt: new Date().toISOString(),
  messageId: 'message-1',
  disposition: 'dispatched' as const,
  highWatermark: 12,
};
database
  .prepare(
    `INSERT INTO messages (id, session_id, role, content)
     VALUES ('message-1', 'delivery-session', 'user', 'hello')`
  )
  .run();
finishMessageDelivery('owner', 'delivery-session', 'delivery-1', accepted, database);
const stored = claimMessageDelivery(
  'owner',
  'delivery-session',
  'delivery-1',
  payloadHash,
  database
);
assert.equal(stored.kind, 'stored');
if (stored.kind === 'stored') assert.deepEqual(stored.acknowledgement, accepted);
assert.equal(
  claimMessageDelivery(
    'owner',
    'delivery-session',
    'delivery-1',
    hashDeliveryPayload({ sessionId: 'delivery-session', message: 'different' }),
    database
  ).kind,
  'conflict'
);

// Crash-after-message-insert: a processing outbox row is reconstructed from
// messages.client_message_id instead of permitting a second provider dispatch.
const crashHash = hashDeliveryPayload({ sessionId: 'delivery-session', message: 'crash turn' });
assert.equal(
  claimMessageDelivery('owner', 'delivery-session', 'crash-id', crashHash, database).kind,
  'claimed'
);
database
  .prepare(
    `INSERT INTO messages (
       id, session_id, role, content, client_message_id, event_sequence
     ) VALUES ('crash-message', 'delivery-session', 'user', 'crash turn', 'crash-id', 31)`
  )
  .run();
let providerDispatches = 0;
const retryClaim = claimMessageDelivery(
  'owner',
  'delivery-session',
  'crash-id',
  crashHash,
  database
);
if (retryClaim.kind === 'claimed') providerDispatches += 1;
assert.equal(providerDispatches, 0);
assert.equal(retryClaim.kind, 'stored');
if (retryClaim.kind === 'stored' && retryClaim.acknowledgement.status === 'accepted') {
  assert.equal(retryClaim.acknowledgement.messageId, 'crash-message');
}

// Sequences reserve 256-value blocks: 600 events need three DB reservations,
// remain strictly monotone, and expose a safe restart gap instead of 600 writes.
resetSessionSequenceAllocatorForTests();
const sequences = Array.from({ length: 600 }, () =>
  nextSessionEventSequence('sync-session', database)
);
assert.ok(sequences.every((value, index) => index === 0 || value > sequences[index - 1]!));
assert.equal(
  (
    database
      .prepare(`SELECT event_sequence AS value FROM sessions WHERE id = 'sync-session'`)
      .get() as { value: number }
  ).value,
  768
);
assert.equal(getSessionSyncState('sync-session', 'owner', database).highWatermark, 600);
resetSessionSequenceAllocatorForTests();
assert.equal(getSessionSyncState('sync-session', 'owner', database).highWatermark, 768);
assert.equal(nextSessionEventSequence('sync-session', database), 769);

// Snapshot revisions include insert/update/delete, and persisted read markers
// count only later assistant messages in the selected chat.
const revisionBefore = getMessageHistorySnapshot('sync-session', 'owner', null, database).revision;
database
  .prepare(
    `INSERT INTO messages (id, session_id, role, content)
     VALUES ('read-1', 'sync-session', 'assistant', 'one'),
            ('read-2', 'sync-session', 'user', 'two'),
            ('read-3', 'sync-session', 'assistant', 'three')`
  )
  .run();
database.prepare(`UPDATE messages SET content = 'one edited' WHERE id = 'read-1'`).run();
database.prepare(`DELETE FROM messages WHERE id = 'read-2'`).run();
assert.equal(
  getMessageHistorySnapshot('sync-session', 'owner', null, database).revision,
  revisionBefore + 5
);
assert.equal(getSessionReadState('owner', 'sync-session', null, database).unreadCount, 2);
assert.equal(
  setSessionReadState(
    'owner',
    'sync-session',
    { chatId: null, lastReadMessageId: 'read-1' },
    database
  ).unreadCount,
  1
);
assert.throws(
  () => setSessionReadState('foreign', 'sync-session', { lastReadMessageId: 'read-3' }, database),
  /Session not found/
);
database
  .prepare(
    `INSERT INTO sessions (id, user_id, name, working_directory, status)
     VALUES ('list-session', 'owner', 'List', '/tmp', 'stopped')`
  )
  .run();
database
  .prepare(
    `INSERT INTO messages (id, session_id, role, content)
     VALUES ('list-1', 'list-session', 'assistant', 'first'),
            ('list-2', 'list-session', 'assistant', 'second')`
  )
  .run();
setSessionReadState(
  'owner',
  'list-session',
  { chatId: null, lastReadMessageId: 'list-1' },
  database
);
const listCounts = database
  .prepare(
    `SELECT s.id, ${sessionUnreadCountSelect('s')}
       FROM sessions s
      WHERE s.user_id = 'owner' AND s.id IN ('sync-session', 'list-session')
      ORDER BY s.id`
  )
  .all() as Array<{ id: string; unreadCount: number }>;
assert.deepEqual(listCounts, [
  { id: 'list-session', unreadCount: 1 },
  { id: 'sync-session', unreadCount: 1 },
]);
assert.throws(
  () =>
    database
      .prepare(
        `INSERT INTO session_reads (user_id, session_id, chat_key, last_read_message_id)
         VALUES ('foreign', 'sync-session', '', 'read-1')`
      )
      .run(),
  /session read ownership mismatch/
);

// Resumable chunks accept out-of-order delivery, verify every chunk and the
// final SHA, and expose no metadata across owners/sessions.
const bytes = Buffer.alloc(700_000);
for (let index = 0; index < bytes.length; index += 1) bytes[index] = index % 251;
const chunkSize = 256 * 1024;
const upload = await createChatUpload(
  'owner',
  'delivery-session',
  {
    filename: '../proof.bin',
    mimeType: 'application/octet-stream',
    byteSize: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    chunkSize,
  },
  database
);
assert.equal(upload.filename, 'proof.bin');
assert.equal(upload.totalChunks, 3);
assert.throws(
  () => getChatUpload('foreign', 'delivery-session', upload.id, database),
  (error) => error instanceof ChatUploadError && error.statusCode === 404
);

const chunks = Array.from({ length: upload.totalChunks }, (_, index) => {
  const start = index * chunkSize;
  const chunk = bytes.subarray(start, Math.min(bytes.length, start + chunkSize));
  return {
    index,
    start,
    bytes: chunk,
    sha: createHash('sha256').update(chunk).digest('hex'),
  };
});
await assert.rejects(
  putChatUploadChunk(
    'owner',
    'delivery-session',
    upload.id,
    1,
    chunks[1]!.bytes,
    '0'.repeat(64),
    {
      start: chunks[1]!.start,
      end: chunks[1]!.start + chunks[1]!.bytes.length - 1,
      total: bytes.length,
    },
    database
  ),
  /SHA-256/
);
for (const index of [1, 0, 2]) {
  const chunk = chunks[index]!;
  const result = await putChatUploadChunk(
    'owner',
    'delivery-session',
    upload.id,
    index,
    chunk.bytes,
    chunk.sha,
    { start: chunk.start, end: chunk.start + chunk.bytes.length - 1, total: bytes.length },
    database
  );
  if (index === 1) {
    // Repeating an identical chunk is idempotent and does not inflate progress.
    const duplicate = await putChatUploadChunk(
      'owner',
      'delivery-session',
      upload.id,
      index,
      chunk.bytes,
      chunk.sha,
      { start: chunk.start, end: chunk.start + chunk.bytes.length - 1, total: bytes.length },
      database
    );
    assert.equal(duplicate.receivedBytes, result.receivedBytes);
  }
}
assert.equal(getChatUpload('owner', 'delivery-session', upload.id, database).status, 'complete');
const staged = await resolveChatUploads(
  'owner',
  'delivery-session',
  [upload.id],
  'delivery-a',
  database
);
assert.equal(Buffer.from(staged[0]!.data, 'base64').equals(bytes), true);
await assert.rejects(
  resolveChatUploads('owner', 'delivery-session', [upload.id], 'delivery-b', database),
  /reserved/
);
releaseChatUploadReservations('owner', 'delivery-session', [upload.id], 'delivery-a', database);
await resolveChatUploads('owner', 'delivery-session', [upload.id], 'delivery-b', database);
database
  .prepare(
    `INSERT INTO messages (id, session_id, role, content, client_message_id)
     VALUES ('upload-message', 'delivery-session', 'user', 'with upload', 'delivery-b')`
  )
  .run();
markChatUploadsConsumed(
  'owner',
  'delivery-session',
  [upload.id],
  'upload-message',
  'delivery-b',
  database
);
await assert.rejects(
  resolveChatUploads('owner', 'delivery-session', [upload.id], 'delivery-b', database),
  /already attached/
);

const userSegment = createHash('sha256').update('owner').digest('hex').slice(0, 32);
const uploadPath = path.join(process.env.CHAT_UPLOAD_DIR!, userSegment, upload.id);
for (let retry = 0; retry < 30 && fs.existsSync(uploadPath); retry += 1) {
  await new Promise((resolve) => setTimeout(resolve, 10));
}
assert.equal(fs.existsSync(uploadPath), false, 'consumed staged bytes should be removed');

const cancelled = await createChatUpload(
  'owner',
  'delivery-session',
  {
    filename: 'cancel.bin',
    byteSize: chunkSize,
    sha256: createHash('sha256').update(Buffer.alloc(chunkSize, 7)).digest('hex'),
    chunkSize,
  },
  database
);
const cancelBytes = Buffer.alloc(chunkSize, 7);
await putChatUploadChunk(
  'owner',
  'delivery-session',
  cancelled.id,
  0,
  cancelBytes,
  createHash('sha256').update(cancelBytes).digest('hex'),
  { start: 0, end: cancelBytes.length - 1, total: cancelBytes.length },
  database
);
assert.equal(
  (await cancelChatUpload('owner', 'delivery-session', cancelled.id, database)).status,
  'cancelled'
);
assert.equal(
  fs.existsSync(path.join(process.env.CHAT_UPLOAD_DIR!, userSegment, cancelled.id)),
  false
);

const expired = await createChatUpload(
  'owner',
  'delivery-session',
  {
    filename: 'expired.bin',
    byteSize: chunkSize,
    sha256: createHash('sha256').update(Buffer.alloc(chunkSize)).digest('hex'),
    chunkSize,
  },
  database
);
database
  .prepare(`UPDATE chat_uploads SET expires_at = '2000-01-01T00:00:00.000Z' WHERE id = ?`)
  .run(expired.id);
assert.throws(
  () => getChatUpload('owner', 'delivery-session', expired.id, database),
  (error) => error instanceof ChatUploadError && error.code === 'UPLOAD_EXPIRED'
);
await cleanupExpiredChatUploads(database);
for (
  let retry = 0;
  retry < 30 && fs.existsSync(path.join(process.env.CHAT_UPLOAD_DIR!, userSegment, expired.id));
  retry += 1
) {
  await new Promise((resolve) => setTimeout(resolve, 10));
}
assert.equal(
  fs.existsSync(path.join(process.env.CHAT_UPLOAD_DIR!, userSegment, expired.id)),
  false
);

await assert.rejects(
  createChatUpload(
    'owner',
    'delivery-session',
    { filename: 'huge', byteSize: 25 * 1024 * 1024 + 1, sha256: 'a'.repeat(64) },
    database
  ),
  /25 MB/
);

await assert.rejects(
  resolveChatUploads(
    'owner',
    'delivery-session',
    Array.from({ length: 11 }, () => randomUUID()),
    'delivery-too-many',
    database
  ),
  (error) => error instanceof ChatUploadError && error.code === 'TOO_MANY_UPLOADS'
);

// Aggregate size is validated from metadata before any completed file is read.
// These intentionally have no files: an ENOENT would prove the check was late.
const aggregateUploadIds = [randomUUID(), randomUUID()];
for (const [index, id] of aggregateUploadIds.entries()) {
  database
    .prepare(
      `INSERT INTO chat_uploads (
         id, user_id, session_id, filename, mime_type, byte_size, sha256,
         chunk_size, total_chunks, received_bytes, status, expires_at
       ) VALUES (?, 'owner', 'delivery-session', ?, 'application/octet-stream', ?, ?,
                 4194304, ?, ?, 'complete', '2099-01-01T00:00:00.000Z')`
    )
    .run(
      id,
      `aggregate-${index}.bin`,
      index === 0 ? 20 * 1024 * 1024 : 13 * 1024 * 1024,
      'a'.repeat(64),
      index === 0 ? 5 : 4,
      index === 0 ? 20 * 1024 * 1024 : 13 * 1024 * 1024
    );
}
await assert.rejects(
  resolveChatUploads(
    'owner',
    'delivery-session',
    aggregateUploadIds,
    'delivery-aggregate',
    database
  ),
  (error) => error instanceof ChatUploadError && error.code === 'UPLOAD_TOTAL_TOO_LARGE'
);

// FTS syntax is never forwarded verbatim; every token becomes a quoted prefix.
assert.equal(buildFtsMatch('foo* OR (bar "'), '"foo"* AND "OR"* AND "bar"*');
assert.equal(buildFtsMatch('***'), null);
assert.equal(escapeMessageSearchLike('100%_done\\next'), '100\\%\\_done\\\\next');
database
  .prepare(
    `INSERT INTO messages (id, session_id, role, content)
     VALUES ('fts-long', 'sync-session', 'assistant', ?),
            ('fts-percent', 'sync-session', 'assistant', 'literal 100%_done value')`
  )
  .run(`${'prefix '.repeat(2_000)}rareNeedle ${'suffix '.repeat(2_000)}`);
const ftsPreview = database
  .prepare(
    `SELECT substr(snippet(messages_fts, 0, '', '', ' … ', 64), 1, 2000) AS content
       FROM messages_fts
      WHERE messages_fts.content MATCH ?`
  )
  .get(buildFtsMatch('rareNeedle')) as { content: string };
assert.ok(ftsPreview.content.includes('rareNeedle'));
assert.ok(ftsPreview.content.length <= 2000);
const escapedLikeCount = (
  database
    .prepare(`SELECT COUNT(*) AS count FROM messages WHERE content LIKE ? ESCAPE '\\'`)
    .get(`%${escapeMessageSearchLike('100%_done')}%`) as { count: number }
).count;
assert.equal(escapedLikeCount, 1);

database.close();
fs.rmSync(temporaryDirectory, { recursive: true, force: true });
console.log('durable chat regression tests passed');
