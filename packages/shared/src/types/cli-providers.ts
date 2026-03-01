import type { CLIProvider } from './session';

export interface CliProviderUpdateResult {
  provider: CLIProvider;
  command: string;
  output: string;
  exitCode: number | null;
  status: 'updated' | 'failed';
}

export interface CliProviderUpdateResponse {
  results: CliProviderUpdateResult[];
}
