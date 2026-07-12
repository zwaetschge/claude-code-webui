import assert from 'node:assert/strict';
import { formatNumber } from '../src/lib/analyticsFormat.js';

assert.equal(formatNumber(999), '999');
assert.equal(formatNumber(1_500), '1.5K');
assert.equal(formatNumber(2_500_000), '2.5M');
assert.equal(formatNumber(1_000_000_000), '1.0B');
assert.equal(formatNumber(3_105_507_305), '3.1B');

console.log('Analytics number-format regression tests passed.');
