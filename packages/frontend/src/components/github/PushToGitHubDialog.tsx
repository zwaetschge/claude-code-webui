import { useState, useEffect } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
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
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Loader2, Github, Upload, Plus, AlertTriangle } from 'lucide-react';
import { api } from '@/services/api';
import type { GitHubRepo } from '@claude-code-webui/shared';
import { CreateRepoDialog } from './CreateRepoDialog';

interface PushToGitHubDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workingDirectory: string;
  currentBranch?: string;
  remotes?: Array<{ name: string; url: string }>;
  onPushed?: () => void;
}

export function PushToGitHubDialog({
  open,
  onOpenChange,
  workingDirectory,
  currentBranch = 'main',
  remotes = [],
  onPushed,
}: PushToGitHubDialogProps) {
  const [remote, setRemote] = useState('origin');
  const [branch, setBranch] = useState(currentBranch);
  const [force, setForce] = useState(false);
  const [showCreateRepo, setShowCreateRepo] = useState(false);
  const [newRemoteUrl, setNewRemoteUrl] = useState('');
  const [addingRemote, setAddingRemote] = useState(false);

  const hasOrigin = remotes.some((r) => r.name === 'origin');

  useEffect(() => {
    setBranch(currentBranch);
  }, [currentBranch]);

  const { data: tokenStatus } = useQuery({
    queryKey: ['github-token'],
    queryFn: async () => {
      const { data } = await api.get<{
        success: boolean;
        data: { hasToken: boolean; tokenPreview: string | null };
      }>('/api/settings/github-token');
      return data.data;
    },
    enabled: open,
  });

  const pushMutation = useMutation({
    mutationFn: async () => {
      const { data } = await api.post<{ success: boolean }>('/api/github/push', {
        workingDirectory,
        remote,
        branch,
        force,
      });
      return data;
    },
    onSuccess: () => {
      onPushed?.();
      onOpenChange(false);
    },
  });

  const addRemoteMutation = useMutation({
    mutationFn: async () => {
      const { data } = await api.post<{ success: boolean }>('/api/github/remote', {
        workingDirectory,
        remoteName: 'origin',
        repoUrl: newRemoteUrl,
      });
      return data;
    },
    onSuccess: () => {
      setAddingRemote(false);
      setNewRemoteUrl('');
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    pushMutation.mutate();
  };

  const handleRepoCreated = (repo: GitHubRepo) => {
    setNewRemoteUrl(repo.html_url);
    setShowCreateRepo(false);
  };

  if (!tokenStatus?.hasToken) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Github className="h-5 w-5" />
              Push to GitHub
            </DialogTitle>
          </DialogHeader>
          <div className="text-center py-6">
            <AlertTriangle className="h-12 w-12 mx-auto text-yellow-500 mb-4" />
            <p className="text-muted-foreground mb-4">
              You need to configure a GitHub token in Settings before pushing to GitHub.
            </p>
            <Button onClick={() => onOpenChange(false)}>Close</Button>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Github className="h-5 w-5" />
              Push to GitHub
            </DialogTitle>
            <DialogDescription>
              Push your changes to GitHub
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSubmit} className="space-y-4">
            {!hasOrigin && !addingRemote && (
              <div className="rounded-md border border-yellow-500/50 bg-yellow-500/10 p-4">
                <p className="text-sm text-yellow-600 dark:text-yellow-400 mb-3">
                  No origin remote configured. Add one or create a new repository.
                </p>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => setAddingRemote(true)}
                  >
                    Add Remote
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => setShowCreateRepo(true)}
                  >
                    <Plus className="h-4 w-4 mr-1" />
                    Create Repo
                  </Button>
                </div>
              </div>
            )}

            {addingRemote && (
              <div className="space-y-2">
                <Label htmlFor="newRemoteUrl">Remote URL</Label>
                <Input
                  id="newRemoteUrl"
                  value={newRemoteUrl}
                  onChange={(e) => setNewRemoteUrl(e.target.value)}
                  placeholder="https://github.com/user/repo.git"
                />
                <div className="flex gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => setAddingRemote(false)}
                  >
                    Cancel
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    disabled={!newRemoteUrl.trim() || addRemoteMutation.isPending}
                    onClick={() => addRemoteMutation.mutate()}
                  >
                    {addRemoteMutation.isPending && (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    )}
                    Add
                  </Button>
                </div>
              </div>
            )}

            {remotes.length > 0 && (
              <div className="space-y-2">
                <Label>Remote</Label>
                <RadioGroup value={remote} onValueChange={setRemote}>
                  {remotes.map((r) => (
                    <div key={r.name} className="flex items-center space-x-2">
                      <RadioGroupItem value={r.name} id={`remote-${r.name}`} />
                      <Label htmlFor={`remote-${r.name}`} className="font-normal">
                        <span className="font-medium">{r.name}</span>
                        <span className="text-muted-foreground ml-2 text-xs truncate max-w-[250px] inline-block">
                          {r.url}
                        </span>
                      </Label>
                    </div>
                  ))}
                </RadioGroup>
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="branch">Branch</Label>
              <Input
                id="branch"
                value={branch}
                onChange={(e) => setBranch(e.target.value)}
                placeholder="main"
              />
            </div>

            <div className="flex items-center justify-between">
              <div className="flex flex-col">
                <Label htmlFor="force">Force push</Label>
                <span className="text-xs text-muted-foreground">
                  Overwrites remote history (use with caution)
                </span>
              </div>
              <Switch id="force" checked={force} onCheckedChange={setForce} />
            </div>

            {force && (
              <div className="rounded-md border border-destructive/50 bg-destructive/10 p-3">
                <p className="text-sm text-destructive">
                  Force push can overwrite commits on the remote. Make sure you know what you're
                  doing.
                </p>
              </div>
            )}

            {pushMutation.isError && (
              <p className="text-sm text-destructive">
                {(pushMutation.error as Error)?.message || 'Failed to push to GitHub'}
              </p>
            )}

            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={pushMutation.isPending || (!hasOrigin && !addingRemote)}
              >
                {pushMutation.isPending ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Upload className="mr-2 h-4 w-4" />
                )}
                Push
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <CreateRepoDialog
        open={showCreateRepo}
        onOpenChange={setShowCreateRepo}
        workingDirectory={workingDirectory}
        onCreated={handleRepoCreated}
      />
    </>
  );
}
