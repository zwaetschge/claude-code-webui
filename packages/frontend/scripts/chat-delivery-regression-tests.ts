import assert from 'node:assert/strict';
import fs from 'node:fs';

import { CHAT_ATTACHMENT_LIMITS, selectChatAttachments } from '../src/components/chat/ChatInput.js';

function file(name: string, size: number, type = 'application/octet-stream'): File {
  return new File([new Uint8Array(size)], name, { type });
}

const first = file('first.txt', 1_024, 'text/plain');
const second = file('second.pdf', 2_048, 'application/pdf');
assert.deepEqual(selectChatAttachments(0, 0, [first, second]).accepted, [first, second]);

const oversized = file('too-large.bin', CHAT_ATTACHMENT_LIMITS.maxFileBytes + 1);
const oversizedSelection = selectChatAttachments(0, 0, [oversized]);
assert.equal(oversizedSelection.accepted.length, 0);
assert.match(oversizedSelection.errors[0] ?? '', /25 MB per-file limit/);

const totalOverflow = file('total-overflow.bin', 2);
const totalSelection = selectChatAttachments(1, CHAT_ATTACHMENT_LIMITS.maxTotalBytes - 1, [
  totalOverflow,
]);
assert.equal(totalSelection.accepted.length, 0);
assert.match(totalSelection.errors[0] ?? '', /32 MB total limit/);

const slotOverflow = selectChatAttachments(CHAT_ATTACHMENT_LIMITS.maxFiles, 0, [first]);
assert.equal(slotOverflow.accepted.length, 0);
assert.match(slotOverflow.errors[0] ?? '', /only 10 files/);

const componentSource = fs.readFileSync(
  new URL('../src/components/chat/ChatInput.tsx', import.meta.url),
  'utf8'
);
const socketSource = fs.readFileSync(new URL('../src/services/socket.ts', import.meta.url), 'utf8');

assert.doesNotMatch(componentSource, /document\.addEventListener\(['"]paste['"]/);
assert.match(componentSource, /<textarea[\s\S]*?onPaste=\{handleComposerPaste\}/);
assert.match(componentSource, /onDragEnter=\{handleDragEnter\}/);
assert.match(componentSource, /onDrop=\{handleDrop\}/);
assert.match(componentSource, /aria-label=\{`Remove \$\{attachment\.file\.name\}`\}/);
assert.doesNotMatch(componentSource, /group-hover:opacity-100/);
assert.match(componentSource, /await Promise\.resolve\(sendResult\)/);
assert.ok(
  componentSource.indexOf('await Promise.resolve(sendResult)') <
    componentSource.indexOf(
      'setAttachments([])',
      componentSource.indexOf('await Promise.resolve(sendResult)')
    ),
  'attachments must only clear after the send acknowledgement'
);
assert.match(componentSource, /clientMessageId: deliveryState\.clientMessageId/);
assert.match(componentSource, /Sent and accepted by the server/);
assert.match(componentSource, />\s*Retry\s*</);
assert.match(componentSource, /onUploadProgress/);
assert.match(componentSource, /uploadAbortRef\.current\?\.abort\(\)/);
assert.match(componentSource, /role="progressbar"/);
assert.match(componentSource, />\s*Cancel\s*</);

assert.match(socketSource, /socket\.timeout\(SEND_ACK_TIMEOUT_MS\)/);
assert.match(socketSource, /clientMessageId = createClientMessageId\(\)/);
assert.match(socketSource, /status: 'rejected'/);
assert.match(socketSource, /Retry is safe/);
assert.match(socketSource, /for \(let attempt = 1; attempt <= 3; attempt \+= 1\)/);
assert.match(socketSource, /currentUpload\.missingChunks/);
assert.match(socketSource, /uploadOptions: FileUploadOptions/);
assert.match(socketSource, /OUTBOX_RETRY_NOTICE_AFTER/);
assert.match(
  socketSource,
  /acknowledgement\.status === 'rejected' && !acknowledgement\.retryable/,
  'retryable send failures must retain staged uploads for the durable outbox'
);

console.log('chat delivery regression tests passed');
