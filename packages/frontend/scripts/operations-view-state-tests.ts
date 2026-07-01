import assert from 'node:assert/strict';
import { getContainerInventoryViewState } from '../src/lib/operationsViewState.ts';

function testAdminErrorsAreExplicit(): void {
  const state = getContainerInventoryViewState({
    dockerStatusLoading: false,
    dockerStatusErrorStatus: 403,
    dockerStatusErrorMessage: 'Admin privileges required',
    dockerAvailable: undefined,
    containersLoading: false,
    containersErrorStatus: undefined,
    containersErrorMessage: undefined,
    totalCount: 0,
    filteredCount: 0,
    query: '',
  });

  assert.equal(state.kind, 'admin-required');
  assert.match(state.title, /Admin/i);
  assert.match(state.description, /Docker/i);
}

function testOfflineDockerIsNotEmptyInventory(): void {
  const state = getContainerInventoryViewState({
    dockerStatusLoading: false,
    dockerStatusErrorStatus: undefined,
    dockerStatusErrorMessage: 'Docker socket not found at /var/run/docker.sock',
    dockerAvailable: false,
    containersLoading: false,
    containersErrorStatus: undefined,
    containersErrorMessage: undefined,
    totalCount: 0,
    filteredCount: 0,
    query: '',
  });

  assert.equal(state.kind, 'docker-offline');
  assert.match(state.description, /socket not found/i);
}

function testInventoryErrorsAreExplicit(): void {
  const state = getContainerInventoryViewState({
    dockerStatusLoading: false,
    dockerStatusErrorStatus: undefined,
    dockerStatusErrorMessage: undefined,
    dockerAvailable: true,
    containersLoading: false,
    containersErrorStatus: 500,
    containersErrorMessage: 'Command failed: docker ps',
    totalCount: 0,
    filteredCount: 0,
    query: '',
  });

  assert.equal(state.kind, 'inventory-error');
  assert.match(state.description, /docker ps/i);
}

function testDockerStatusErrorsAreExplicit(): void {
  const state = getContainerInventoryViewState({
    dockerStatusLoading: false,
    dockerStatusErrorStatus: 500,
    dockerStatusErrorMessage: 'Docker status probe failed',
    dockerAvailable: undefined,
    containersLoading: false,
    containersErrorStatus: undefined,
    containersErrorMessage: undefined,
    totalCount: 0,
    filteredCount: 0,
    query: '',
  });

  assert.equal(state.kind, 'docker-offline');
  assert.match(state.description, /status probe failed/i);
}

function testReadyAndEmptySearchStates(): void {
  assert.deepEqual(
    getContainerInventoryViewState({
      dockerStatusLoading: false,
      dockerStatusErrorStatus: undefined,
      dockerStatusErrorMessage: undefined,
      dockerAvailable: true,
      containersLoading: false,
      containersErrorStatus: undefined,
      containersErrorMessage: undefined,
      totalCount: 85,
      filteredCount: 85,
      query: '',
    }),
    {
      kind: 'ready',
      title: 'Containers',
      description: '85 of 85 containers shown.',
    }
  );

  const emptySearch = getContainerInventoryViewState({
    dockerStatusLoading: false,
    dockerStatusErrorStatus: undefined,
    dockerStatusErrorMessage: undefined,
    dockerAvailable: true,
    containersLoading: false,
    containersErrorStatus: undefined,
    containersErrorMessage: undefined,
    totalCount: 85,
    filteredCount: 0,
    query: 'missing',
  });

  assert.equal(emptySearch.kind, 'empty-search');
  assert.match(emptySearch.description, /missing/);
}

testAdminErrorsAreExplicit();
testOfflineDockerIsNotEmptyInventory();
testInventoryErrorsAreExplicit();
testDockerStatusErrorsAreExplicit();
testReadyAndEmptySearchStates();
console.log('operations view state tests passed');
