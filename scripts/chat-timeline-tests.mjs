import assert from 'node:assert/strict';
import fs from 'node:fs';

const sessionPage = fs.readFileSync(
  new URL('../packages/frontend/src/pages/SessionPage.tsx', import.meta.url),
  'utf8'
);
const messageBubble = fs.readFileSync(
  new URL('../packages/frontend/src/components/chat/MessageBubble.tsx', import.meta.url),
  'utf8'
);
const chatMediaImage = fs.readFileSync(
  new URL('../packages/frontend/src/components/chat/ChatMediaImage.tsx', import.meta.url),
  'utf8'
);
const styles = fs.readFileSync(
  new URL('../packages/frontend/src/index.css', import.meta.url),
  'utf8'
);

assert.match(
  sessionPage,
  /className="chat-quick-timeline-label"[\s\S]*?<time>\{marker\.time\}<\/time>[\s\S]*?<strong>\{marker\.title\}<\/strong>/,
  'the unified timeline rail must expose both time and event title'
);
assert.doesNotMatch(
  sessionPage,
  /timeline-continuation-rail/,
  'tool and image entries must not reintroduce an in-content timeline rail'
);
assert.doesNotMatch(
  messageBubble,
  /className="ai-rail"/,
  'assistant messages must use the unified right-hand timeline rail'
);
assert.match(
  styles,
  /\.turn-asst\s*\{\s*display:\s*block;/,
  'assistant content must reclaim the former left-rail column'
);
assert.match(
  chatMediaImage,
  /api\s*\.download\(mediaUrl, \{ signal: controller\.signal \}\)/,
  'assistant media must use the authenticated API client instead of a token query string'
);
assert.doesNotMatch(
  chatMediaImage,
  /[?&]token=/,
  'assistant media URLs must never expose the bearer token in the query string'
);
assert.match(
  chatMediaImage,
  /URL\.revokeObjectURL\(activeObjectUrl\)/,
  'assistant media blob URLs must be revoked on cleanup'
);
assert.match(
  chatMediaImage,
  /Image could not be loaded[\s\S]*Try again/,
  'assistant media must provide a visible error and retry action'
);
assert.match(
  messageBubble,
  /assistantMediaFilenames[\s\S]*legacyAttachments[\s\S]*ChatMediaImage/,
  'assistant media must render without duplicating legacy attachments'
);
assert.match(
  messageBubble,
  /mediaSignature\(prev\.message\) === mediaSignature\(next\.message\)/,
  'message memoization must invalidate when media metadata changes'
);
assert.match(
  styles,
  /\.chat-media-image\s*\{[\s\S]*?object-fit:\s*contain;/,
  'chat media must preserve complete QR codes instead of cropping them'
);
assert.match(
  styles,
  /@media \(hover: none\), \(max-width: 640px\)[\s\S]*?\.chat-media-grid,[\s\S]*?width:\s*100%;/,
  'chat media must fit narrow and touch viewports'
);

console.log('chat timeline tests passed');
