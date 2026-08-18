import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, KeyRound, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { CliDeviceLoginDialog } from '@/components/settings/CliDeviceLoginDialog';
import { api } from '@/services/api';
import type { ApiResponse } from '@plum-code-webui/shared';

interface Harness {
  id: string;
  name: string;
  icon: string;
  kind: 'cli-login' | 'provider-keys' | 'endpoint';
  hint: string;
  installed: boolean;
  credentials: boolean;
  enabled: boolean;
  modelCount: number;
  ready: boolean;
}

interface Endpoint {
  id: string;
  name: string;
  baseUrl: string | null;
  enabled: boolean;
  hasKey: boolean;
  modelCount: number;
}

interface SetupStatus {
  ready: boolean;
  harnesses: Harness[];
  endpoints: Endpoint[];
  antigravity: { available: boolean; authenticated: boolean };
}

const DEVICE_LOGIN = new Set(['codex', 'claude', 'kimi']);

/**
 * Every way into a provider, in one place.
 *
 * The methods genuinely differ — a device code for the CLI harnesses, an API
 * key for endpoints, an in-session OAuth for Antigravity — so this shows each
 * one with the step it actually needs instead of pretending they are uniform.
 */
export function ProviderLoginsPanel() {
  const queryClient = useQueryClient();

  const { data: status } = useQuery({
    queryKey: ['setup-status'],
    queryFn: async () => {
      const response = await api.get<ApiResponse<SetupStatus>>('/api/setup/status');
      return response.data.data;
    },
    refetchInterval: 15_000,
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['setup-status'] });

  if (!status) return null;

  const harnesses = status.harnesses.filter((h) => h.kind === 'cli-login');

  return (
    <div className="space-y-5">
      <section className="space-y-2">
        <header>
          <h3 className="text-sm font-medium">Harness sign-in</h3>
          <p className="text-xs text-muted-foreground">
            Device-code login: start it here, approve in the browser, paste the code back.
          </p>
        </header>
        <ul className="space-y-1.5">
          {harnesses.map((harness) => (
            <li
              key={harness.id}
              className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2"
            >
              <span className="min-w-0">
                <span className="flex items-center gap-2 text-sm">
                  <span aria-hidden>{harness.icon}</span>
                  {harness.name}
                  {harness.credentials && (
                    <span className="inline-flex items-center gap-1 text-xs text-emerald-500">
                      <Check className="h-3 w-3" /> signed in
                    </span>
                  )}
                </span>
                <span className="block truncate text-xs text-muted-foreground">
                  {harness.credentials
                    ? `${harness.modelCount} model${harness.modelCount === 1 ? '' : 's'}`
                    : harness.hint}
                </span>
              </span>
              {DEVICE_LOGIN.has(harness.id) && (
                <CliDeviceLoginDialog
                  provider={harness.id as 'codex' | 'claude' | 'kimi'}
                  authenticated={harness.credentials}
                  onCompleted={refresh}
                />
              )}
            </li>
          ))}
        </ul>
      </section>

      <section className="space-y-2">
        <header>
          <h3 className="text-sm font-medium">API endpoints</h3>
          <p className="text-xs text-muted-foreground">
            Keys for OpenAI-compatible providers. Pi and OpenCode both resolve their models from
            here.
          </p>
        </header>
        {status.endpoints.length === 0 ? (
          <p className="text-xs text-muted-foreground">No endpoints yet.</p>
        ) : (
          <ul className="space-y-1.5">
            {status.endpoints.map((endpoint) => (
              <li
                key={endpoint.id}
                className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2"
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm">{endpoint.name}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {endpoint.baseUrl ?? endpoint.id}
                    {endpoint.hasKey ? ' · key stored' : ' · no key'}
                    {endpoint.enabled ? '' : ' · disabled'}
                  </span>
                </span>
                <RemoveEndpointButton id={endpoint.id} onDone={refresh} />
              </li>
            ))}
          </ul>
        )}
        <AddEndpointForm onSaved={refresh} />
      </section>

      {status.antigravity.available && (
        <section className="space-y-2 rounded-lg border border-border px-3 py-3">
          <header>
            <h3 className="flex items-center gap-2 text-sm font-medium">
              Google Antigravity (via Pi)
              {status.antigravity.authenticated && (
                <span className="inline-flex items-center gap-1 text-xs text-emerald-500">
                  <Check className="h-3 w-3" /> signed in
                </span>
              )}
            </h3>
          </header>
          <div className="flex items-start justify-between gap-3">
            <p className="min-w-0 text-xs text-muted-foreground">
              {status.antigravity.authenticated
                ? 'Signed in — the antigravity/* models are selectable in Pi sessions.'
                : 'Sign in with Google to use the antigravity/* models in Pi. Using this may violate Google’s Terms of Service.'}
            </p>
            <CliDeviceLoginDialog
              provider="pi"
              authenticated={status.antigravity.authenticated}
              onCompleted={refresh}
            />
          </div>
        </section>
      )}
    </div>
  );
}

function RemoveEndpointButton({ id, onDone }: { id: string; onDone: () => void }) {
  const remove = useMutation({
    mutationFn: async () => {
      await api.delete(`/api/opencode/providers/${encodeURIComponent(id)}`);
    },
    onSuccess: onDone,
  });
  return (
    <Button
      type="button"
      size="sm"
      variant="ghost"
      onClick={() => remove.mutate()}
      disabled={remove.isPending}
      aria-label={`Remove ${id}`}
    >
      <Trash2 className="h-3.5 w-3.5" />
    </Button>
  );
}

function AddEndpointForm({ onSaved }: { onSaved: () => void }) {
  const [open, setOpen] = useState(false);
  const [id, setId] = useState('');
  const [name, setName] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: async () => {
      await api.put('/api/opencode/providers', {
        id: id.trim(),
        name: name.trim() || id.trim(),
        apiKey: apiKey.trim(),
        ...(baseUrl.trim() ? { baseUrl: baseUrl.trim() } : {}),
        enabled: true,
      });
    },
    onSuccess: () => {
      setOpen(false);
      setId('');
      setName('');
      setApiKey('');
      setBaseUrl('');
      onSaved();
    },
    onError: (mutationError) =>
      setError(mutationError instanceof Error ? mutationError.message : 'Could not save endpoint'),
  });

  if (!open) {
    return (
      <Button type="button" size="sm" variant="outline" onClick={() => setOpen(true)}>
        <Plus className="mr-1 h-3.5 w-3.5" />
        Add endpoint
      </Button>
    );
  }

  return (
    <form
      className="grid gap-3 rounded-lg border border-border p-3 sm:grid-cols-2"
      onSubmit={(event) => {
        event.preventDefault();
        setError(null);
        save.mutate();
      }}
    >
      <div>
        <Label htmlFor="login-endpoint-id">Provider ID</Label>
        <Input
          id="login-endpoint-id"
          value={id}
          onChange={(event) => setId(event.target.value)}
          placeholder="z-ai"
          required
        />
      </div>
      <div>
        <Label htmlFor="login-endpoint-name">Display name</Label>
        <Input
          id="login-endpoint-name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Z.AI"
        />
      </div>
      <div>
        <Label htmlFor="login-endpoint-key">API key</Label>
        <Input
          id="login-endpoint-key"
          type="password"
          value={apiKey}
          onChange={(event) => setApiKey(event.target.value)}
          required
        />
      </div>
      <div>
        <Label htmlFor="login-endpoint-url">Base URL (optional)</Label>
        <Input
          id="login-endpoint-url"
          value={baseUrl}
          onChange={(event) => setBaseUrl(event.target.value)}
          placeholder="Known providers fill this in"
        />
      </div>
      {error && <p className="text-xs text-destructive sm:col-span-2">{error}</p>}
      <div className="flex gap-2 sm:col-span-2">
        <Button type="submit" size="sm" disabled={save.isPending}>
          <KeyRound className="mr-1 h-3.5 w-3.5" />
          {save.isPending ? 'Saving…' : 'Save endpoint'}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

export default ProviderLoginsPanel;
