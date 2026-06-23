import { Shield, ShieldAlert, Check, X, Terminal, FileText, Edit3, Globe } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { socketService } from '@/services/socket';
import { cn } from '@/lib/utils';
import type { PermissionDenial } from '@plum-code-webui/shared';
import { useProviderStore } from '@/stores/providerStore';
import { UI_PROVIDER_META } from '@/lib/providers';

interface PermissionRequestCardProps {
  sessionId: string;
  denials: PermissionDenial[];
  originalMessage: string;
  className?: string;
  providerLabel?: string;
}

// Get display info for a tool
function getToolDisplay(toolName: string): {
  icon: typeof Terminal;
  label: string;
  description: string;
} {
  const tools: Record<string, { icon: typeof Terminal; label: string; description: string }> = {
    Bash: { icon: Terminal, label: 'Terminal', description: 'Execute shell commands' },
    Write: { icon: FileText, label: 'Write File', description: 'Create or overwrite files' },
    Edit: { icon: Edit3, label: 'Edit File', description: 'Modify file contents' },
    WebFetch: { icon: Globe, label: 'Web Fetch', description: 'Fetch content from URLs' },
  };
  return tools[toolName] || { icon: Shield, label: toolName, description: 'Tool access' };
}

// Format tool input for display
function formatToolInput(toolName: string, input: Record<string, unknown>): string {
  if (toolName === 'Bash' && input.command) {
    const cmd = String(input.command);
    return cmd.length > 100 ? cmd.substring(0, 100) + '...' : cmd;
  }
  if ((toolName === 'Write' || toolName === 'Edit' || toolName === 'Read') && input.file_path) {
    return String(input.file_path);
  }
  if (toolName === 'WebFetch' && input.url) {
    return String(input.url);
  }
  return JSON.stringify(input).substring(0, 100);
}

export function PermissionRequestCard({
  sessionId,
  denials,
  originalMessage,
  className,
  providerLabel: explicitProviderLabel,
}: PermissionRequestCardProps) {
  const { uiProvider } = useProviderStore();
  const providerLabel = explicitProviderLabel ?? UI_PROVIDER_META[uiProvider].label;
  const handleApprove = () => {
    const toolNames = denials.map((d) => d.tool_name);
    socketService.approvePermission(sessionId, toolNames, originalMessage);
  };

  const handleDeny = () => {
    socketService.denyPermission(sessionId);
  };

  // Group denials by tool name for cleaner display
  const uniqueTools = [...new Set(denials.map((d) => d.tool_name))];

  return (
    <Card className={cn('p-4 bg-amber-500/10 border-amber-500/30 animate-fade-in', className)}>
      <div className="space-y-4">
        {/* Header */}
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-full bg-amber-500/20">
            <ShieldAlert className="h-5 w-5 text-amber-500" />
          </div>
          <div>
            <h3 className="font-semibold text-amber-600 dark:text-amber-400">
              Permission Required
            </h3>
            <p className="text-sm text-muted-foreground">
              {providerLabel} wants to use the following tools:
            </p>
          </div>
        </div>

        {/* Tool list */}
        <div className="space-y-2">
          {denials.map((denial, index) => {
            const { icon: ToolIcon, label, description } = getToolDisplay(denial.tool_name);
            return (
              <div
                key={`${denial.tool_use_id}-${index}`}
                className="flex items-start gap-3 p-3 rounded-lg bg-background/50 border"
              >
                <ToolIcon className="h-5 w-5 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm">{label}</span>
                    <span className="text-xs text-muted-foreground">({description})</span>
                  </div>
                  <pre className="mt-1 text-xs text-muted-foreground font-mono bg-muted/50 p-2 rounded overflow-x-auto max-w-full">
                    {formatToolInput(denial.tool_name, denial.tool_input)}
                  </pre>
                </div>
              </div>
            );
          })}
        </div>

        {/* Action buttons */}
        <div className="flex gap-2 justify-end">
          <Button variant="outline" size="sm" onClick={handleDeny} className="gap-1.5">
            <X className="h-4 w-4" />
            Deny
          </Button>
          <Button
            size="sm"
            onClick={handleApprove}
            className="gap-1.5 bg-amber-600 hover:bg-amber-700 text-white"
          >
            <Check className="h-4 w-4" />
            Approve {uniqueTools.length > 1 ? `All (${uniqueTools.length})` : ''}
          </Button>
        </div>
      </div>
    </Card>
  );
}
