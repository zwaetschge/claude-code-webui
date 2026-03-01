import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Loader2, Github, Lock, Globe } from 'lucide-react';
import { api } from '@/services/api';
import type { GitHubRepo } from '@claude-code-webui/shared';

interface CreateRepoDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workingDirectory?: string;
  onCreated?: (repo: GitHubRepo) => void;
}

export function CreateRepoDialog({
  open,
  onOpenChange,
  workingDirectory,
  onCreated,
}: CreateRepoDialogProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [isPrivate, setIsPrivate] = useState(false);
  const [autoInit, setAutoInit] = useState(false);
  const [addRemote, setAddRemote] = useState(!!workingDirectory);

  const queryClient = useQueryClient();

  const createMutation = useMutation({
    mutationFn: async () => {
      const { data } = await api.post<{ success: boolean; data: GitHubRepo }>('/api/github/repos', {
        name,
        description: description || undefined,
        private: isPrivate,
        auto_init: autoInit,
      });
      return data.data;
    },
    onSuccess: async (repo) => {
      // Add remote if requested
      if (addRemote && workingDirectory) {
        await api.post('/api/github/remote', {
          workingDirectory,
          remoteName: 'origin',
          repoUrl: repo.html_url,
        });
      }

      queryClient.invalidateQueries({ queryKey: ['github-repos'] });
      onCreated?.(repo);
      onOpenChange(false);
      resetForm();
    },
  });

  const resetForm = () => {
    setName('');
    setDescription('');
    setIsPrivate(false);
    setAutoInit(false);
    setAddRemote(!!workingDirectory);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (name.trim()) {
      createMutation.mutate();
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Github className="h-5 w-5" />
            Create GitHub Repository
          </DialogTitle>
          <DialogDescription>
            Create a new repository on GitHub
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">Repository name *</Label>
            <Input
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="my-awesome-project"
              pattern="^[a-zA-Z0-9._-]+$"
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="description">Description</Label>
            <Input
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="A short description"
            />
          </div>

          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              {isPrivate ? (
                <Lock className="h-4 w-4 text-muted-foreground" />
              ) : (
                <Globe className="h-4 w-4 text-muted-foreground" />
              )}
              <Label htmlFor="private">
                {isPrivate ? 'Private' : 'Public'}
              </Label>
            </div>
            <Switch
              id="private"
              checked={isPrivate}
              onCheckedChange={setIsPrivate}
            />
          </div>

          {!workingDirectory && (
            <div className="flex items-center justify-between">
              <Label htmlFor="autoInit">Initialize with README</Label>
              <Switch
                id="autoInit"
                checked={autoInit}
                onCheckedChange={setAutoInit}
              />
            </div>
          )}

          {workingDirectory && (
            <div className="flex items-center justify-between">
              <Label htmlFor="addRemote">Add as origin remote</Label>
              <Switch
                id="addRemote"
                checked={addRemote}
                onCheckedChange={setAddRemote}
              />
            </div>
          )}

          {createMutation.isError && (
            <p className="text-sm text-destructive">
              {(createMutation.error as Error)?.message || 'Failed to create repository'}
            </p>
          )}

          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={createMutation.isPending || !name.trim()}>
              {createMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Create Repository
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
