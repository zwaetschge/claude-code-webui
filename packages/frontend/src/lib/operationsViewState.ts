export type ContainerInventoryViewState =
  | {
      kind: 'loading';
      title: string;
      description: string;
    }
  | {
      kind: 'admin-required';
      title: string;
      description: string;
    }
  | {
      kind: 'docker-offline';
      title: string;
      description: string;
    }
  | {
      kind: 'inventory-error';
      title: string;
      description: string;
    }
  | {
      kind: 'empty';
      title: string;
      description: string;
    }
  | {
      kind: 'empty-search';
      title: string;
      description: string;
    }
  | {
      kind: 'ready';
      title: string;
      description: string;
    };

export interface ContainerInventoryViewStateInput {
  dockerStatusLoading: boolean;
  dockerStatusErrorStatus: number | undefined;
  dockerStatusErrorMessage: string | undefined;
  dockerAvailable: boolean | undefined;
  containersLoading: boolean;
  containersErrorStatus: number | undefined;
  containersErrorMessage: string | undefined;
  totalCount: number;
  filteredCount: number;
  query: string;
}

function fallback(message: string | undefined, fallbackMessage: string): string {
  const trimmed = message?.trim();
  return trimmed || fallbackMessage;
}

export function getContainerInventoryViewState(
  input: ContainerInventoryViewStateInput
): ContainerInventoryViewState {
  if (input.dockerStatusErrorStatus === 401 || input.containersErrorStatus === 401) {
    return {
      kind: 'admin-required',
      title: 'Sign in required',
      description: 'Sign in with an admin account to read Docker operations data.',
    };
  }

  if (input.dockerStatusErrorStatus === 403 || input.containersErrorStatus === 403) {
    return {
      kind: 'admin-required',
      title: 'Admin access required',
      description: 'The Operations tab needs an admin account to read Docker inventory.',
    };
  }

  if (input.dockerStatusErrorStatus || input.dockerStatusErrorMessage) {
    return {
      kind: 'docker-offline',
      title: 'Docker host unavailable',
      description: fallback(input.dockerStatusErrorMessage, 'Docker status probe failed.'),
    };
  }

  if (input.dockerStatusLoading || input.dockerAvailable === undefined) {
    return {
      kind: 'loading',
      title: 'Loading containers',
      description: 'Checking Docker host availability.',
    };
  }

  if (input.dockerAvailable === false) {
    return {
      kind: 'docker-offline',
      title: 'Docker host unavailable',
      description: fallback(input.dockerStatusErrorMessage, 'Docker integration is not available.'),
    };
  }

  if (input.containersLoading) {
    return {
      kind: 'loading',
      title: 'Loading containers',
      description: 'Reading Docker container inventory.',
    };
  }

  if (input.containersErrorStatus || input.containersErrorMessage) {
    return {
      kind: 'inventory-error',
      title: 'Container inventory failed',
      description: fallback(input.containersErrorMessage, 'Docker container inventory failed.'),
    };
  }

  if (input.totalCount === 0) {
    return {
      kind: 'empty',
      title: 'No containers found',
      description: 'Docker is connected, but it did not report any containers.',
    };
  }

  if (input.filteredCount === 0) {
    const term = input.query.trim();
    return {
      kind: 'empty-search',
      title: 'No matching containers',
      description: term
        ? `No containers match "${term}".`
        : 'No containers match the current filters.',
    };
  }

  return {
    kind: 'ready',
    title: 'Containers',
    description: `${input.filteredCount} of ${input.totalCount} containers shown.`,
  };
}
