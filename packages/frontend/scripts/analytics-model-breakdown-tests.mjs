import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const analyticsSource = readFileSync(
  new URL('../src/pages/AnalyticsPage.tsx', import.meta.url),
  'utf8'
);

assert.match(
  analyticsSource,
  /models: entry\.models\.sort\(\(a, b\) => b\.tokens - a\.tokens\)/,
  'provider model breakdown must be ordered by token volume without a top-three truncation'
);
assert.match(
  analyticsSource,
  /\{formatNumber\(model\.tokens\)\} tokens/,
  'each provider model chip must display its own token count'
);
assert.doesNotMatch(
  analyticsSource,
  /entry\.models\.sort\([\s\S]{0,100}\.slice\(0, 3\)/,
  'provider model breakdown must not hide models after the first three'
);
assert.match(
  analyticsSource,
  /Usage &amp; Limits Over Time/,
  'analytics must present usage and provider limits as one combined timeline'
);
assert.match(
  analyticsSource,
  /visibleLimitOverlaySeries\.map\(\(series\) => \([\s\S]{0,220}dataKey=\{series\.key\}/,
  'the combined timeline must render every available provider limit series'
);
assert.doesNotMatch(
  analyticsSource,
  /<ProviderLimitHistory\b/,
  'analytics must not render a second standalone limit-history chart'
);
assert.match(
  analyticsSource,
  /return sortedBuckets\.map\(\(bucket, index\)/,
  'quota history must be resampled onto the existing usage buckets'
);
assert.match(
  analyticsSource,
  /isCurrentBucket \? samplesInBucket\.at\(-1\) : samplesInBucket\[0\]/,
  'completed buckets must use their opening quota while the current bucket uses the latest sample'
);
assert.doesNotMatch(
  analyticsSource,
  /overlayPoints\.forEach\([\s\S]{0,500}buckets\.set/,
  'quota samples must not create sparse zero-token buckets in the stacked usage chart'
);
assert.match(
  analyticsSource,
  /All limits · \{limitOverlaySeries\.length\}/,
  'the chart controls must make the all-limits default explicit'
);
assert.match(
  analyticsSource,
  /limitOverlayProvider === 'all'[\s\S]{0,180}limitOverlaySeries\.filter\(\(series\) => series\.provider === limitOverlayProvider\)/,
  'the all-limits default must retain a provider-specific single view'
);
assert.match(
  analyticsSource,
  /limitOverlayProvider === 'all'[\s\S]{0,180}modelSeries\.filter\([\s\S]{0,160}USAGE_TRACKER_ANALYTICS_LABEL\[limitOverlayProvider\]/,
  'the provider single view must filter token model series together with limit series'
);
assert.match(
  analyticsSource,
  /const timelineGranularity = period === '24h' \? 'hour' : 'day'/,
  'the 24-hour analytics view must request hourly timeline buckets'
);
assert.match(
  analyticsSource,
  /granularity=\$\{timelineGranularity\}/,
  'the selected timeline granularity must be sent to the analytics API'
);
assert.match(
  analyticsSource,
  /period === '24h' && analyticsWindow\?\.startsAt && analyticsWindow\?\.endsAt/,
  'the 24-hour chart must build a complete clock-hour grid from the analytics window'
);
assert.match(
  analyticsSource,
  /timestamp \+= 60 \* 60 \* 1000/,
  'the 24-hour chart grid must advance in one-hour intervals'
);
assert.match(
  analyticsSource,
  /<Area[\s\S]{0,180}type="monotone"/,
  'usage must retain the smooth area curves on the complete time grid'
);
assert.match(
  analyticsSource,
  /<Line[\s\S]{0,180}type="monotone"[\s\S]{0,120}dataKey=\{series\.key\}/,
  'every combined limit overlay must use a smooth curve'
);

console.log('Analytics model breakdown regression tests passed.');
