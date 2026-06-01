import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Bot,
  Plus,
  Edit3,
  Trash2,
  Copy,
  Loader2,
  Search,
  Code,
  FileText,
  CheckCircle,
  Settings,
  Shield,
  Zap,
  Sparkles,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { api } from '@/services/api';
import { toast } from '@/hooks/use-toast';
import type { ApiResponse } from '@claude-code-webui/shared';
import { cn } from '@/lib/utils';

interface CustomAgent {
  id: string;
  name: string;
  description: string | null;
  system_prompt: string;
  model: string;
  allowedTools: string[];
  permission_mode: string;
  icon: string;
  color: string;
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

interface AgentPreset {
  id: string;
  name: string;
  description: string;
  systemPrompt: string;
  icon: string;
  color: string;
}

const ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  bot: Bot,
  code: Code,
  'file-text': FileText,
  'check-circle': CheckCircle,
  settings: Settings,
  shield: Shield,
  zap: Zap,
  search: Search,
  sparkles: Sparkles,
};

const COLORS = [
  { value: 'violet', label: 'Violet', class: 'bg-violet-500' },
  { value: 'blue', label: 'Blue', class: 'bg-blue-500' },
  { value: 'cyan', label: 'Cyan', class: 'bg-cyan-500' },
  { value: 'green', label: 'Green', class: 'bg-green-500' },
  { value: 'yellow', label: 'Yellow', class: 'bg-yellow-500' },
  { value: 'orange', label: 'Orange', class: 'bg-orange-500' },
  { value: 'red', label: 'Red', class: 'bg-red-500' },
  { value: 'pink', label: 'Pink', class: 'bg-pink-500' },
];

const MODELS = [
  { value: 'gpt-5.5', label: 'GPT 5.5' },
  { value: 'gpt-5.4', label: 'GPT 5.4' },
  { value: 'gpt-5.4-mini', label: 'GPT 5.4 Mini' },
  { value: 'gpt-5.3-codex', label: 'GPT 5.3 Codex' },
  { value: 'gpt-5.2', label: 'GPT 5.2' },
  { value: 'claude-opus-4-5', label: 'Claude Opus 4.5 (Legacy)' },
  { value: 'claude-sonnet-4-5', label: 'Claude Sonnet 4.5 (Legacy)' },
  { value: 'claude-haiku-4-5', label: 'Claude Haiku 4.5 (Legacy)' },
];

const PERMISSION_MODES = [
  { value: 'auto-accept', label: 'Auto Accept' },
  { value: 'manual', label: 'Manual Approval' },
  { value: 'planning', label: 'Planning Mode' },
];

interface AgentsManagerProps {
  className?: string;
  onAgentSelect?: (agent: CustomAgent) => void;
  selectionMode?: boolean;
}

export function AgentsManager({ className, onAgentSelect, selectionMode }: AgentsManagerProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [showEditDialog, setShowEditDialog] = useState<CustomAgent | null>(null);
  const [showDeleteDialog, setShowDeleteDialog] = useState<CustomAgent | null>(null);
  const [showPresetsDialog, setShowPresetsDialog] = useState(false);

  // Form state
  const [formName, setFormName] = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [formSystemPrompt, setFormSystemPrompt] = useState('');
  const [formModel, setFormModel] = useState('gpt-5.5');
  const [formPermissionMode, setFormPermissionMode] = useState('auto-accept');
  const [formIcon, setFormIcon] = useState('bot');
  const [formColor, setFormColor] = useState('violet');

  const queryClient = useQueryClient();

  // Fetch agents
  const { data: agents, isLoading } = useQuery({
    queryKey: ['custom-agents'],
    queryFn: async () => {
      const response = await api.get<ApiResponse<CustomAgent[]>>('/api/agents');
      if (response.data.success && response.data.data) {
        return response.data.data;
      }
      return [];
    },
  });

  // Fetch presets
  const { data: presets } = useQuery({
    queryKey: ['agent-presets'],
    queryFn: async () => {
      const response = await api.get<ApiResponse<AgentPreset[]>>('/api/agents/presets/templates');
      if (response.data.success && response.data.data) {
        return response.data.data;
      }
      return [];
    },
  });

  // Create agent
  const createMutation = useMutation({
    mutationFn: async (data: {
      name: string;
      description: string;
      systemPrompt: string;
      model: string;
      permissionMode: string;
      icon: string;
      color: string;
    }) => {
      const response = await api.post<ApiResponse<CustomAgent>>('/api/agents', data);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['custom-agents'] });
      setShowCreateDialog(false);
      resetForm();
      toast({ title: 'Agent created successfully' });
    },
    onError: (error: Error) => {
      toast({
        title: 'Failed to create agent',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  // Update agent
  const updateMutation = useMutation({
    mutationFn: async ({
      id,
      ...data
    }: {
      id: string;
      name?: string;
      description?: string;
      systemPrompt?: string;
      model?: string;
      permissionMode?: string;
      icon?: string;
      color?: string;
      enabled?: boolean;
    }) => {
      const response = await api.put<ApiResponse<CustomAgent>>(`/api/agents/${id}`, data);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['custom-agents'] });
      setShowEditDialog(null);
      toast({ title: 'Agent updated successfully' });
    },
    onError: (error: Error) => {
      toast({
        title: 'Failed to update agent',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  // Delete agent
  const deleteMutation = useMutation({
    mutationFn: async (agentId: string) => {
      const response = await api.delete<ApiResponse<void>>(`/api/agents/${agentId}`);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['custom-agents'] });
      setShowDeleteDialog(null);
      toast({ title: 'Agent deleted' });
    },
    onError: (error: Error) => {
      toast({
        title: 'Failed to delete agent',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  // Duplicate agent
  const duplicateMutation = useMutation({
    mutationFn: async (agentId: string) => {
      const response = await api.post<ApiResponse<CustomAgent>>(`/api/agents/${agentId}/duplicate`);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['custom-agents'] });
      toast({ title: 'Agent duplicated' });
    },
    onError: (error: Error) => {
      toast({
        title: 'Failed to duplicate agent',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  const resetForm = () => {
    setFormName('');
    setFormDescription('');
    setFormSystemPrompt('');
    setFormModel('gpt-5.5');
    setFormPermissionMode('auto-accept');
    setFormIcon('bot');
    setFormColor('violet');
  };

  const openEditDialog = (agent: CustomAgent) => {
    setFormName(agent.name);
    setFormDescription(agent.description || '');
    setFormSystemPrompt(agent.system_prompt);
    setFormModel(agent.model);
    setFormPermissionMode(agent.permission_mode);
    setFormIcon(agent.icon);
    setFormColor(agent.color);
    setShowEditDialog(agent);
  };

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    if (formName.trim() && formSystemPrompt.trim()) {
      createMutation.mutate({
        name: formName.trim(),
        description: formDescription.trim(),
        systemPrompt: formSystemPrompt.trim(),
        model: formModel,
        permissionMode: formPermissionMode,
        icon: formIcon,
        color: formColor,
      });
    }
  };

  const handleUpdate = (e: React.FormEvent) => {
    e.preventDefault();
    if (showEditDialog && formName.trim() && formSystemPrompt.trim()) {
      updateMutation.mutate({
        id: showEditDialog.id,
        name: formName.trim(),
        description: formDescription.trim(),
        systemPrompt: formSystemPrompt.trim(),
        model: formModel,
        permissionMode: formPermissionMode,
        icon: formIcon,
        color: formColor,
      });
    }
  };

  const handlePresetSelect = (preset: AgentPreset) => {
    setFormName(preset.name);
    setFormDescription(preset.description);
    setFormSystemPrompt(preset.systemPrompt);
    setFormIcon(preset.icon);
    setFormColor(preset.color);
    setShowPresetsDialog(false);
    setShowCreateDialog(true);
  };

  const filteredAgents =
    agents?.filter(
      (agent) =>
        agent.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        agent.description?.toLowerCase().includes(searchQuery.toLowerCase())
    ) || [];

  const getIcon = (iconName: string) => {
    const IconComponent = ICONS[iconName] || Bot;
    return IconComponent;
  };

  const getColorClass = (colorName: string) => {
    return COLORS.find((c) => c.value === colorName)?.class || 'bg-violet-500';
  };

  return (
    <div className={cn('flex flex-col h-full', className)}>
      {/* Header */}
      <div className="shrink-0 space-y-3 mb-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold">Custom Agents</h2>
            <p className="text-sm text-muted-foreground">
              Create specialized agents with custom system prompts
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setShowPresetsDialog(true)}>
              <Sparkles className="h-4 w-4 mr-1" />
              Templates
            </Button>
            <Button size="sm" onClick={() => setShowCreateDialog(true)}>
              <Plus className="h-4 w-4 mr-1" />
              New Agent
            </Button>
          </div>
        </div>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search agents..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
          />
        </div>
      </div>

      {/* Agents List */}
      <ScrollArea className="flex-1">
        <div className="space-y-3">
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : filteredAgents.length === 0 ? (
            <div className="text-center py-8 px-4">
              <Bot className="h-10 w-10 text-muted-foreground/50 mx-auto mb-3" />
              <p className="text-sm text-muted-foreground">
                {searchQuery ? 'No agents match your search' : 'No custom agents yet'}
              </p>
              {!searchQuery && (
                <div className="flex justify-center gap-2 mt-4">
                  <Button variant="outline" size="sm" onClick={() => setShowPresetsDialog(true)}>
                    Browse Templates
                  </Button>
                  <Button size="sm" onClick={() => setShowCreateDialog(true)}>
                    Create Agent
                  </Button>
                </div>
              )}
            </div>
          ) : (
            filteredAgents.map((agent) => {
              const IconComponent = getIcon(agent.icon);
              return (
                <div
                  key={agent.id}
                  onClick={() => selectionMode && onAgentSelect?.(agent)}
                  className={cn(
                    'group relative p-4 rounded-lg border bg-card transition-colors',
                    selectionMode && 'cursor-pointer hover:bg-muted/50',
                    !agent.enabled && 'opacity-60'
                  )}
                >
                  <div className="flex items-start gap-4">
                    <div className={cn('shrink-0 p-2.5 rounded-lg', getColorClass(agent.color))}>
                      <IconComponent className="h-5 w-5 text-white" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <h3 className="font-medium">{agent.name}</h3>
                        {!agent.enabled && (
                          <span className="text-xs px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                            Disabled
                          </span>
                        )}
                      </div>
                      {agent.description && (
                        <p className="text-sm text-muted-foreground mt-1 line-clamp-2">
                          {agent.description}
                        </p>
                      )}
                      <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground">
                        <span>
                          {MODELS.find((m) => m.value === agent.model)?.label || agent.model}
                        </span>
                        <span>
                          {PERMISSION_MODES.find((m) => m.value === agent.permission_mode)?.label}
                        </span>
                      </div>
                    </div>

                    {/* Actions */}
                    {!selectionMode && (
                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          onClick={(e) => {
                            e.stopPropagation();
                            openEditDialog(agent);
                          }}
                          title="Edit"
                        >
                          <Edit3 className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          onClick={(e) => {
                            e.stopPropagation();
                            duplicateMutation.mutate(agent.id);
                          }}
                          title="Duplicate"
                        >
                          <Copy className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-destructive hover:text-destructive"
                          onClick={(e) => {
                            e.stopPropagation();
                            setShowDeleteDialog(agent);
                          }}
                          title="Delete"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </ScrollArea>

      {/* Create/Edit Dialog */}
      <Dialog
        open={showCreateDialog || !!showEditDialog}
        onOpenChange={(open) => {
          if (!open) {
            setShowCreateDialog(false);
            setShowEditDialog(null);
            resetForm();
          }
        }}
      >
        <DialogContent className="sm:max-w-xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Bot className="h-5 w-5" />
              {showEditDialog ? 'Edit Agent' : 'Create Agent'}
            </DialogTitle>
            <DialogDescription>
              {showEditDialog
                ? 'Update your custom agent configuration'
                : 'Create a new custom agent with a specialized system prompt'}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={showEditDialog ? handleUpdate : handleCreate} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Name</label>
                <Input
                  placeholder="e.g., Code Reviewer"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Model</label>
                <Select value={formModel} onValueChange={setFormModel}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {MODELS.map((model) => (
                      <SelectItem key={model.value} value={model.value}>
                        {model.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Description</label>
              <Input
                placeholder="Brief description of what this agent does..."
                value={formDescription}
                onChange={(e) => setFormDescription(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">System Prompt</label>
              <textarea
                className="w-full min-h-[150px] px-3 py-2 text-sm rounded-md border bg-background resize-y"
                placeholder="Define the agent's role, capabilities, and behavior..."
                value={formSystemPrompt}
                onChange={(e) => setFormSystemPrompt(e.target.value)}
              />
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Permission Mode</label>
                <Select value={formPermissionMode} onValueChange={setFormPermissionMode}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PERMISSION_MODES.map((mode) => (
                      <SelectItem key={mode.value} value={mode.value}>
                        {mode.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Icon</label>
                <Select value={formIcon} onValueChange={setFormIcon}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(ICONS).map(([key, Icon]) => (
                      <SelectItem key={key} value={key}>
                        <div className="flex items-center gap-2">
                          <Icon className="h-4 w-4" />
                          <span className="capitalize">{key.replace('-', ' ')}</span>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Color</label>
                <Select value={formColor} onValueChange={setFormColor}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {COLORS.map((color) => (
                      <SelectItem key={color.value} value={color.value}>
                        <div className="flex items-center gap-2">
                          <div className={cn('h-4 w-4 rounded', color.class)} />
                          {color.label}
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {showEditDialog && (
              <div className="flex items-center justify-between py-2 px-3 rounded-lg bg-muted/50">
                <div>
                  <span className="text-sm font-medium">Enabled</span>
                  <p className="text-xs text-muted-foreground">
                    Show this agent in selection lists
                  </p>
                </div>
                <Switch
                  checked={showEditDialog.enabled}
                  onCheckedChange={(checked) =>
                    updateMutation.mutate({ id: showEditDialog.id, enabled: checked })
                  }
                />
              </div>
            )}

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setShowCreateDialog(false);
                  setShowEditDialog(null);
                  resetForm();
                }}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={
                  !formName.trim() ||
                  !formSystemPrompt.trim() ||
                  createMutation.isPending ||
                  updateMutation.isPending
                }
              >
                {createMutation.isPending || updateMutation.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    {showEditDialog ? 'Saving...' : 'Creating...'}
                  </>
                ) : showEditDialog ? (
                  'Save Changes'
                ) : (
                  'Create Agent'
                )}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete Dialog */}
      <Dialog open={!!showDeleteDialog} onOpenChange={() => setShowDeleteDialog(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <Trash2 className="h-5 w-5" />
              Delete Agent
            </DialogTitle>
            <DialogDescription>
              Are you sure you want to delete this agent? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <div className="p-3 rounded-lg bg-muted/50 border">
              <p className="font-medium">{showDeleteDialog?.name}</p>
              {showDeleteDialog?.description && (
                <p className="text-sm text-muted-foreground mt-1">{showDeleteDialog.description}</p>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDeleteDialog(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => showDeleteDialog && deleteMutation.mutate(showDeleteDialog.id)}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Deleting...
                </>
              ) : (
                'Delete Agent'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Presets Dialog */}
      <Dialog open={showPresetsDialog} onOpenChange={setShowPresetsDialog}>
        <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="h-5 w-5" />
              Agent Templates
            </DialogTitle>
            <DialogDescription>
              Start with a pre-configured template and customize it to your needs
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3 py-4">
            {presets?.map((preset) => {
              const IconComponent = getIcon(preset.icon);
              return (
                <button
                  key={preset.id}
                  onClick={() => handlePresetSelect(preset)}
                  className="p-4 rounded-lg border bg-card hover:bg-muted/50 transition-colors text-left"
                >
                  <div className="flex items-start gap-3">
                    <div className={cn('shrink-0 p-2 rounded-lg', getColorClass(preset.color))}>
                      <IconComponent className="h-4 w-4 text-white" />
                    </div>
                    <div>
                      <h4 className="font-medium">{preset.name}</h4>
                      <p className="text-sm text-muted-foreground mt-1 line-clamp-2">
                        {preset.description}
                      </p>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default AgentsManager;
