import { useState } from 'react';
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
import { ScrollArea } from '@/components/ui/scroll-area';
import { Loader2, Github, Search, Lock, Globe, Star, GitBranch } from 'lucide-react';
import { api } from '@/services/api';
import type { GitHubRepo } from '@claude-code-webui/shared';

interface CloneRepoDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultTargetDir?: string;
  onCloned?: (path: string) => void;
}

export function CloneRepoDialog({
  open,
  onOpenChange,
  defaultTargetDir = '/tmp',
  onCloned,
}: CloneRepoDialogProps) {
  const [url, setUrl] = useState('');
  const [targetDir, setTargetDir] = useState(defaultTargetDir);
  const [branch, setBranch] = useState('');
  const [search, setSearch] = useState('');
  const [showRepoList, setShowRepoList] = useState(true);

  const { data: reposData, isLoading: reposLoading } = useQuery({
    queryKey: ['github-repos'],
    queryFn: async () => {
      const { data } = await api.get<{ success: boolean; data: { repos: GitHubRepo[]; hasMore: boolean } }>(
        '/api/github/repos?per_page=50'
      );
      return data.data;
    },
    enabled: open,
  });

  const cloneMutation = useMutation({
    mutationFn: async () => {
      const { data } = await api.post<{ success: boolean; data: { path: string } }>('/api/github/clone', {
        url,
        targetDir,
        branch: branch || undefined,
      });
      return data.data;
    },
    onSuccess: (data) => {
      onCloned?.(data.path);
      onOpenChange(false);
      resetForm();
    },
  });

  const resetForm = () => {
    setUrl('');
    setTargetDir(defaultTargetDir);
    setBranch('');
    setSearch('');
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (url.trim() && targetDir.trim()) {
      cloneMutation.mutate();
    }
  };

  const selectRepo = (repo: GitHubRepo) => {
    setUrl(repo.clone_url);
    setTargetDir(`${defaultTargetDir}/${repo.name}`);
    setShowRepoList(false);
  };

  const filteredRepos = reposData?.repos.filter(
    (repo) =>
      repo.name.toLowerCase().includes(search.toLowerCase()) ||
      repo.description?.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Github className="h-5 w-5" />
            Clone Repository
          </DialogTitle>
          <DialogDescription>
            Clone a repository from GitHub
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {showRepoList && (
            <div className="space-y-2">
              <div className="relative">
                <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search your repositories..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-8"
                />
              </div>

              <ScrollArea className="h-[200px] border rounded-md">
                {reposLoading ? (
                  <div className="flex items-center justify-center h-full">
                    <Loader2 className="h-6 w-6 animate-spin" />
                  </div>
                ) : filteredRepos?.length === 0 ? (
                  <div className="flex items-center justify-center h-full text-muted-foreground">
                    No repositories found
                  </div>
                ) : (
                  <div className="p-2 space-y-1">
                    {filteredRepos?.map((repo) => (
                      <button
                        key={repo.id}
                        type="button"
                        onClick={() => selectRepo(repo)}
                        className="w-full text-left px-3 py-2 rounded-md hover:bg-accent transition-colors"
                      >
                        <div className="flex items-center gap-2">
                          {repo.private ? (
                            <Lock className="h-4 w-4 text-muted-foreground" />
                          ) : (
                            <Globe className="h-4 w-4 text-muted-foreground" />
                          )}
                          <span className="font-medium">{repo.full_name}</span>
                          {repo.stargazers_count > 0 && (
                            <span className="flex items-center gap-1 text-xs text-muted-foreground">
                              <Star className="h-3 w-3" />
                              {repo.stargazers_count}
                            </span>
                          )}
                        </div>
                        {repo.description && (
                          <p className="text-sm text-muted-foreground truncate mt-1">
                            {repo.description}
                          </p>
                        )}
                        <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
                          {repo.language && <span>{repo.language}</span>}
                          <span className="flex items-center gap-1">
                            <GitBranch className="h-3 w-3" />
                            {repo.default_branch}
                          </span>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </ScrollArea>

              <Button
                type="button"
                variant="link"
                className="text-sm"
                onClick={() => setShowRepoList(false)}
              >
                Or enter a URL manually
              </Button>
            </div>
          )}

          {!showRepoList && (
            <>
              <div className="space-y-2">
                <Label htmlFor="url">Repository URL *</Label>
                <Input
                  id="url"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="https://github.com/user/repo.git"
                  required
                />
                <Button
                  type="button"
                  variant="link"
                  className="text-sm p-0 h-auto"
                  onClick={() => setShowRepoList(true)}
                >
                  Select from your repositories
                </Button>
              </div>

              <div className="space-y-2">
                <Label htmlFor="targetDir">Target Directory *</Label>
                <Input
                  id="targetDir"
                  value={targetDir}
                  onChange={(e) => setTargetDir(e.target.value)}
                  placeholder="/path/to/clone"
                  required
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="branch">Branch (optional)</Label>
                <Input
                  id="branch"
                  value={branch}
                  onChange={(e) => setBranch(e.target.value)}
                  placeholder="main"
                />
              </div>
            </>
          )}

          {cloneMutation.isError && (
            <p className="text-sm text-destructive">
              {(cloneMutation.error as Error)?.message || 'Failed to clone repository'}
            </p>
          )}

          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={cloneMutation.isPending || showRepoList || !url.trim() || !targetDir.trim()}
            >
              {cloneMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Clone Repository
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
