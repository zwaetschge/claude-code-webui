import { useState, useEffect, useCallback } from 'react';
import {
  Bot,
  Plus,
  Trash2,
  Eye,
  EyeOff,
  TestTube,
  Loader2,
  AlertCircle,
  CheckCircle,
  Settings2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog';
import { api } from '@/services/api';
import { cn } from '@/lib/utils';

interface Provider {
  id: string;
  user_id: string;
  name: string;
  type: string;
  base_url: string | null;
  models: string | null;
  default_model: string | null;
  enabled: number;
  created_at: string;
  updated_at: string;
}

interface ProviderType {
  id: string;
  name: string;
  baseUrl: string;
  models: string[];
  requiresApiKey: boolean;
  icon: string;
}

interface ApiProvidersResponse {
  success: boolean;
  data?: Provider[];
}

interface ApiProviderTypesResponse {
  success: boolean;
  data?: ProviderType[];
}

interface ApiProviderResponse {
  success: boolean;
  data?: Provider;
}

interface ApiTestResponse {
  success: boolean;
  data?: { success: boolean; message: string };
}

const PROVIDER_ICONS: Record<string, string> = {
  anthropic: '\ud83d\udfe0',
  openai: '\ud83d\udfe2',
  google: '\ud83d\udfe1',
  openrouter: '\ud83c\udf10',
  zai: '\ud83c\udf0f',
  ollama: '\ud83e\udd99',
  custom: '\u2699\ufe0f',
};

export function ProvidersSettings() {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [providerTypes, setProviderTypes] = useState<ProviderType[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingProvider, setEditingProvider] = useState<Provider | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);

  // Form state
  const [formData, setFormData] = useState({
    name: '',
    type: 'openai',
    apiKey: '',
    baseUrl: '',
    models: '',
    defaultModel: '',
  });
  const [showApiKey, setShowApiKey] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [providersRes, typesRes] = await Promise.all([
        api.get<ApiProvidersResponse>('/api/providers'),
        api.get<ApiProviderTypesResponse>('/api/providers/types'),
      ]);

      if (providersRes.data.success && providersRes.data.data) {
        setProviders(providersRes.data.data);
      }
      if (typesRes.data.success && typesRes.data.data) {
        setProviderTypes(typesRes.data.data);
      }
    } catch (error) {
      console.error('Failed to fetch providers:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const openNewDialog = () => {
    setEditingProvider(null);
    setFormData({
      name: '',
      type: 'openai',
      apiKey: '',
      baseUrl: '',
      models: '',
      defaultModel: '',
    });
    setDialogOpen(true);
  };

  const openEditDialog = (provider: Provider) => {
    setEditingProvider(provider);
    setFormData({
      name: provider.name,
      type: provider.type,
      apiKey: '', // Don't show existing key
      baseUrl: provider.base_url || '',
      models: provider.models || '',
      defaultModel: provider.default_model || '',
    });
    setDialogOpen(true);
  };

  const handleTypeChange = (type: string) => {
    const providerType = providerTypes.find((t) => t.id === type);
    setFormData({
      ...formData,
      type,
      baseUrl: providerType?.baseUrl || '',
      models: providerType?.models.join(', ') || '',
      defaultModel: providerType?.models[0] || '',
    });
  };

  const saveProvider = async () => {
    try {
      const data = {
        name: formData.name || formData.type,
        type: formData.type,
        apiKey: formData.apiKey || undefined,
        baseUrl: formData.baseUrl || undefined,
        models: formData.models || undefined,
        defaultModel: formData.defaultModel || undefined,
      };

      if (editingProvider) {
        const response = await api.patch<ApiProviderResponse>(`/api/providers/${editingProvider.id}`, data);
        if (response.data.success && response.data.data) {
          setProviders(providers.map((p) => (p.id === editingProvider.id ? response.data.data! : p)));
        }
      } else {
        const response = await api.post<ApiProviderResponse>('/api/providers', data);
        if (response.data.success && response.data.data) {
          setProviders([...providers, response.data.data]);
        }
      }

      setDialogOpen(false);
    } catch (error) {
      console.error('Failed to save provider:', error);
    }
  };

  const deleteProvider = async (id: string) => {
    try {
      await api.delete(`/api/providers/${id}`);
      setProviders(providers.filter((p) => p.id !== id));
    } catch (error) {
      console.error('Failed to delete provider:', error);
    }
  };

  const toggleProvider = async (provider: Provider) => {
    try {
      const response = await api.patch<ApiProviderResponse>(`/api/providers/${provider.id}`, {
        enabled: !provider.enabled,
      });
      if (response.data.success && response.data.data) {
        setProviders(providers.map((p) => (p.id === provider.id ? response.data.data! : p)));
      }
    } catch (error) {
      console.error('Failed to toggle provider:', error);
    }
  };

  const testProvider = async (id: string) => {
    setTestingId(id);
    setTestResult(null);

    try {
      const response = await api.post<ApiTestResponse>(`/api/providers/${id}/test`);
      setTestResult(response.data.data || { success: false, message: 'Unknown error' });
    } catch (error) {
      setTestResult({
        success: false,
        message: error instanceof Error ? error.message : 'Test failed',
      });
    } finally {
      setTestingId(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-medium">AI Providers</h3>
          <p className="text-sm text-muted-foreground">
            Configure multiple AI providers for your sessions
          </p>
        </div>
        <Button onClick={openNewDialog}>
          <Plus className="h-4 w-4 mr-2" />
          Add Provider
        </Button>
      </div>

      {/* Providers list */}
      <div className="grid gap-4">
        {providers.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-8">
              <Bot className="h-12 w-12 text-muted-foreground mb-4" />
              <p className="text-muted-foreground text-center">
                No providers configured yet.
                <br />
                Add a provider to get started.
              </p>
            </CardContent>
          </Card>
        ) : (
          providers.map((provider) => (
            <Card key={provider.id} className={cn(!provider.enabled && 'opacity-50')}>
              <CardHeader className="py-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <span className="text-2xl">{PROVIDER_ICONS[provider.type] || '\u2699\ufe0f'}</span>
                    <div>
                      <CardTitle className="text-base">{provider.name}</CardTitle>
                      <CardDescription className="text-xs">
                        {provider.type} - {provider.default_model || 'No default model'}
                      </CardDescription>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => testProvider(provider.id)}
                      disabled={testingId === provider.id}
                    >
                      {testingId === provider.id ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <TestTube className="h-4 w-4" />
                      )}
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => openEditDialog(provider)}>
                      <Settings2 className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-destructive"
                      onClick={() => deleteProvider(provider.id)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                    <Switch
                      checked={!!provider.enabled}
                      onCheckedChange={() => toggleProvider(provider)}
                    />
                  </div>
                </div>
              </CardHeader>
              {testResult && testingId === null && (
                <CardContent className="pt-0 pb-4">
                  <div
                    className={cn(
                      'flex items-center gap-2 text-sm px-3 py-2 rounded-md',
                      testResult.success
                        ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                        : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                    )}
                  >
                    {testResult.success ? (
                      <CheckCircle className="h-4 w-4" />
                    ) : (
                      <AlertCircle className="h-4 w-4" />
                    )}
                    {testResult.message}
                  </div>
                </CardContent>
              )}
            </Card>
          ))
        )}
      </div>

      {/* Add/Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editingProvider ? 'Edit Provider' : 'Add Provider'}</DialogTitle>
            <DialogDescription>
              Configure your AI provider settings
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div>
              <Label>Provider Type</Label>
              <Select value={formData.type} onValueChange={handleTypeChange}>
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {providerTypes.map((type) => (
                    <SelectItem key={type.id} value={type.id}>
                      <span className="flex items-center gap-2">
                        <span>{PROVIDER_ICONS[type.id] || '\u2699\ufe0f'}</span>
                        {type.name}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label>Display Name</Label>
              <Input
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder={formData.type}
                className="mt-1"
              />
            </div>

            <div>
              <Label>API Key</Label>
              <div className="relative mt-1">
                <Input
                  type={showApiKey ? 'text' : 'password'}
                  value={formData.apiKey}
                  onChange={(e) => setFormData({ ...formData, apiKey: e.target.value })}
                  placeholder={editingProvider ? '\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022' : 'sk-...'}
                  className="pr-10"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7"
                  onClick={() => setShowApiKey(!showApiKey)}
                >
                  {showApiKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </Button>
              </div>
              {editingProvider && (
                <p className="text-xs text-muted-foreground mt-1">
                  Leave empty to keep existing key
                </p>
              )}
            </div>

            <div>
              <Label>Base URL</Label>
              <Input
                value={formData.baseUrl}
                onChange={(e) => setFormData({ ...formData, baseUrl: e.target.value })}
                placeholder="https://api.openai.com/v1"
                className="mt-1"
              />
            </div>

            <div>
              <Label>Models (comma-separated)</Label>
              <Input
                value={formData.models}
                onChange={(e) => setFormData({ ...formData, models: e.target.value })}
                placeholder="gpt-4, gpt-3.5-turbo"
                className="mt-1"
              />
            </div>

            <div>
              <Label>Default Model</Label>
              <Input
                value={formData.defaultModel}
                onChange={(e) => setFormData({ ...formData, defaultModel: e.target.value })}
                placeholder="gpt-4"
                className="mt-1"
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={saveProvider}>
              {editingProvider ? 'Save' : 'Add'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default ProvidersSettings;
