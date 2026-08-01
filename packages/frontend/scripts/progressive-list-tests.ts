import assert from 'node:assert/strict';

import {
  AGENT_INITIAL_COUNT,
  AGENT_PAGE_SIZE,
  CAPABILITY_INITIAL_COUNT,
  CAPABILITY_PAGE_SIZE,
  getNextVisibleCount,
  getVisibleItems,
} from '../src/lib/progressiveList.js';

const agents = Array.from({ length: 83 }, (_, index) => `agent-${index + 1}`);
const capabilities = Array.from({ length: 119 }, (_, index) => `capability-${index + 1}`);

assert.equal(getVisibleItems(agents, AGENT_INITIAL_COUNT).length, 6);
assert.equal(getVisibleItems(capabilities, CAPABILITY_INITIAL_COUNT).length, 9);
assert.equal(getNextVisibleCount(18, agents.length, AGENT_PAGE_SIZE), 36);
assert.equal(getNextVisibleCount(72, agents.length, AGENT_PAGE_SIZE), 83);
assert.equal(getNextVisibleCount(120, capabilities.length, CAPABILITY_PAGE_SIZE), 119);
assert.deepEqual(getVisibleItems(['match'], CAPABILITY_PAGE_SIZE), ['match']);
assert.deepEqual(getVisibleItems(agents, -1), []);

console.log('Progressive list regression tests passed.');
