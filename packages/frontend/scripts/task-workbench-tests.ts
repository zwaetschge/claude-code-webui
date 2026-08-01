import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  getActiveTodoPresentation,
  getTaskWorkbenchState,
  type TaskWorkbenchStateInput,
} from '../src/components/session/taskWorkbenchState.js';

const activeTodo = getActiveTodoPresentation([
  { content: 'Already done', status: 'completed' },
  { content: 'Queued fallback', status: 'pending' },
  {
    content: 'Implement capability',
    activeForm: 'Implementing capability',
    status: 'in_progress',
  },
]);

assert.equal(activeTodo.todo?.content, 'Implement capability');
assert.equal(activeTodo.text, 'Implementing capability');
assert.deepEqual(getActiveTodoPresentation([{ content: 'Done', status: 'completed' }]), {
  todo: undefined,
  text: undefined,
});

const baseInput: TaskWorkbenchStateInput = {
  sessionStatus: 'stopped',
  isActive: false,
  pendingTasksCount: 0,
  completedTasksCount: 0,
  totalTasksCount: 0,
  canUseCodexGoal: true,
  composerSteersWhileActive: false,
  composerQueuesWhileActive: false,
  queuedDepth: 0,
  hasSelectedTool: false,
};

assert.deepEqual(getTaskWorkbenchState(baseInput), {
  headerTone: 'idle',
  headerStatusLabel: 'Idle',
  headerDetail: 'No active task yet',
  progressLabel: 'No plan yet',
  composerStatusLabel: '',
  composerStatusDetail: '',
});

const queuedState = getTaskWorkbenchState({
  ...baseInput,
  isActive: true,
  pendingTasksCount: 2,
  completedTasksCount: 1,
  totalTasksCount: 3,
  composerQueuesWhileActive: true,
  queuedDepth: 2,
  activeTodoText: 'Running focused tests',
  activityMessage: 'Typechecking frontend',
});
assert.equal(queuedState.headerTone, 'working');
assert.equal(queuedState.headerStatusLabel, 'Working');
assert.equal(queuedState.headerDetail, 'Typechecking frontend');
assert.equal(queuedState.progressLabel, '1/3 done');
assert.equal(queuedState.composerStatusLabel, '2 queued');
assert.equal(queuedState.composerStatusDetail, 'Running focused tests');

const steeringState = getTaskWorkbenchState({
  ...baseInput,
  isActive: true,
  composerSteersWhileActive: true,
  activeAgentLabel: 'Reviewer',
});
assert.equal(steeringState.headerStatusLabel, 'Steering');
assert.equal(steeringState.headerDetail, 'Reviewer running');
assert.equal(steeringState.composerStatusLabel, 'Steering active run');
assert.equal(steeringState.composerStatusDetail, 'Reviewer running');

const errorState = getTaskWorkbenchState({
  ...baseInput,
  sessionStatus: 'error',
  isActive: true,
  composerQueuesWhileActive: true,
  lastMessage: 'Provider disconnected',
});
assert.equal(errorState.headerTone, 'error', 'errors must dominate active-run styling');
assert.equal(errorState.headerStatusLabel, 'Needs attention');
assert.equal(errorState.headerDetail, 'Provider disconnected');

const selectedToolState = getTaskWorkbenchState({
  ...baseInput,
  canUseCodexGoal: false,
  hasSelectedTool: true,
  selectedToolName: 'Android builder',
});
assert.equal(selectedToolState.progressLabel, 'No task list');
assert.equal(selectedToolState.composerStatusLabel, 'Android builder');

const componentSource = fs.readFileSync(
  new URL('../src/components/session/TaskWorkbench.tsx', import.meta.url),
  'utf8'
);
assert.match(componentSource, /title="Open run view"/);
assert.match(componentSource, /title="Open goal and tasks"/);
assert.match(
  componentSource,
  /title=\{canInterruptActiveRun \? 'Stop active run' : 'Restart session'\}/
);
assert.match(componentSource, /mode === 'desktop' \? 'hidden md:flex' : 'md:hidden'/);
assert.match(componentSource, /todo\.status === 'in_progress' && todo\.activeForm/);

console.log('Task workbench regression tests passed.');
