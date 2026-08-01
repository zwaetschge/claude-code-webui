import assert from 'node:assert/strict';
import {
  HOME_ASSISTANT_STATUS_PATTERNS,
  homeAssistantStatusForGoalStatus,
  homeAssistantStatusForSessionEvent,
  isHomeAssistantLightEntityId,
  normalizeHomeAssistantUrl,
} from '../src/services/home-assistant/HomeAssistantStatusLightService.js';

assert.equal(
  normalizeHomeAssistantUrl('http://homeassistant.local:8123/'),
  'http://homeassistant.local:8123'
);
assert.equal(normalizeHomeAssistantUrl('https://ha.example.com///'), 'https://ha.example.com');
assert.throws(() => normalizeHomeAssistantUrl('ftp://ha.example.com'), /http or https/);

assert.equal(isHomeAssistantLightEntityId('light.office_status'), true);
assert.equal(isHomeAssistantLightEntityId('switch.office_status'), false);
assert.equal(isHomeAssistantLightEntityId('light.Bad Name'), false);

assert.equal(homeAssistantStatusForGoalStatus('completed'), 'success');
assert.equal(homeAssistantStatusForGoalStatus('blocked'), 'problem');
assert.equal(homeAssistantStatusForGoalStatus('in_progress'), null);

assert.equal(homeAssistantStatusForSessionEvent('session.needs_input', 'warning'), 'question');
assert.equal(
  homeAssistantStatusForSessionEvent('session.permission_requested', 'warning'),
  'question'
);
assert.equal(homeAssistantStatusForSessionEvent('session.error', 'error'), 'problem');
assert.equal(homeAssistantStatusForSessionEvent('watchdog.incident', 'critical'), 'problem');
assert.equal(homeAssistantStatusForSessionEvent('goal.updated', 'info'), null);

assert.deepEqual(HOME_ASSISTANT_STATUS_PATTERNS.success.color, [0, 255, 70]);
assert.deepEqual(HOME_ASSISTANT_STATUS_PATTERNS.problem.color, [255, 0, 0]);
assert.deepEqual(HOME_ASSISTANT_STATUS_PATTERNS.question.color, [0, 90, 255]);
assert.deepEqual(
  HOME_ASSISTANT_STATUS_PATTERNS.question.steps.map((step) => step.high),
  [true, false, true, false],
  'question pattern must remain a heartbeat double pulse'
);

console.log('Home Assistant status light regression tests passed');
