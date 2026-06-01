import { useState } from 'react';
import { Brain, CheckCircle, Hand, Zap, ChevronDown, Check, Wrench, Sparkles } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { CLI_PROVIDER_ICON, CLI_PROVIDER_LABEL } from '@/lib/providers';
import type { CLIProvider, SessionMode, CliTool } from '@claude-code-webui/shared';

interface ProviderInfo {
  id: CLIProvider;
  name: string;
  available: boolean;
}

interface ReasoningOption {
  value: string;
  label: string;
}

interface SessionSettingsChipProps {
  mode: SessionMode;
  onModeChange: (mode: SessionMode) => void;

  provider: CLIProvider;
  providers?: ProviderInfo[];
  onProviderChange: (provider: CLIProvider) => void;

  modelValue: string;
  modelOptions: string[];
  modelLabels: Record<string, string>;
  resolvedDefaultModel?: string;
  onModelChange: (value: string) => void;

  reasoningValue?: string;
  reasoningOptions?: ReasoningOption[];
  onReasoningChange?: (value: string) => void;
  reasoningLabel?: string;
  codexFastMode?: boolean;

  cliTools?: CliTool[];
  selectedCliTool?: string | null;
  onCliToolChange?: (id: string | null) => void;
}

const modeConfig: Record<
  SessionMode,
  {
    label: string;
    description: string;
    icon: typeof Brain;
    color: string;
    bgColor: string;
    ring: string;
  }
> = {
  planning: {
    label: 'Plan',
    description: 'Plans but asks before executing',
    icon: Brain,
    color: 'text-blue-500',
    bgColor: 'bg-blue-500/10 hover:bg-blue-500/15',
    ring: 'ring-blue-500/30',
  },
  'auto-accept': {
    label: 'Auto',
    description: 'Automatically approve safe operations',
    icon: CheckCircle,
    color: 'text-green-500',
    bgColor: 'bg-green-500/10 hover:bg-green-500/15',
    ring: 'ring-green-500/30',
  },
  manual: {
    label: 'Manual',
    description: 'Approve each operation manually',
    icon: Hand,
    color: 'text-amber-500',
    bgColor: 'bg-amber-500/10 hover:bg-amber-500/15',
    ring: 'ring-amber-500/30',
  },
  danger: {
    label: 'YOLO',
    description: 'Skip all confirmations (dangerous!)',
    icon: Zap,
    color: 'text-red-500',
    bgColor: 'bg-red-500/10 hover:bg-red-500/15',
    ring: 'ring-red-500/30',
  },
};

function shortModelLabel(
  value: string,
  labels: Record<string, string>,
  defaultModel?: string
): string {
  if (value === '__default__') {
    const label = defaultModel ? labels[defaultModel] || defaultModel : 'Default';
    return label.length > 16 ? label.slice(0, 14) + '…' : label;
  }
  const label = labels[value] || value;
  return label.length > 16 ? label.slice(0, 14) + '…' : label;
}

export function SessionSettingsChip({
  mode,
  onModeChange,
  provider,
  providers,
  onProviderChange,
  modelValue,
  modelOptions,
  modelLabels,
  resolvedDefaultModel,
  onModelChange,
  reasoningValue,
  reasoningOptions,
  onReasoningChange,
  reasoningLabel,
  codexFastMode,
  cliTools,
  selectedCliTool,
  onCliToolChange,
}: SessionSettingsChipProps) {
  const [open, setOpen] = useState(false);
  const current = modeConfig[mode];
  const ModeIcon = current.icon;
  const modelShort = shortModelLabel(modelValue, modelLabels, resolvedDefaultModel);
  const hasReasoning = !!reasoningOptions && reasoningOptions.length > 0 && !!onReasoningChange;
  const hasCliTools = !!cliTools && cliTools.length > 0 && !!onCliToolChange;
  const fastModeActive = provider === 'codex' && codexFastMode;
  const activeCliTool =
    hasCliTools && selectedCliTool ? cliTools!.find((t) => t.id === selectedCliTool) : null;

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className={cn(
            'h-7 gap-2 px-2.5 rounded-lg border border-border/60 text-xs',
            current.bgColor,
            current.color,
            open && `ring-2 ${current.ring}`
          )}
          title={`${current.label} mode · ${CLI_PROVIDER_LABEL[provider]} · ${modelShort}${fastModeActive ? ' · Fast' : ''}`}
        >
          <ModeIcon className="h-3.5 w-3.5 shrink-0" />
          <span className="font-medium hidden sm:inline">{current.label}</span>
          <span className="h-3 w-px bg-current opacity-30 hidden sm:inline-block" />
          <span className="text-[10px] font-semibold opacity-80 hidden sm:inline">
            {CLI_PROVIDER_ICON[provider] || ''}
          </span>
          <span className="text-[11px] font-mono opacity-90 hidden md:inline max-w-[100px] truncate">
            {modelShort}
          </span>
          {fastModeActive && (
            <span className="rounded-md border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[9px] font-semibold text-amber-600 dark:text-amber-300">
              FAST
            </span>
          )}
          {activeCliTool && (
            <span className="inline-flex items-center gap-1 rounded-md bg-primary/15 px-1.5 py-0.5 text-[9px] font-medium text-primary">
              <Wrench className="h-2.5 w-2.5" />
              <span className="hidden sm:inline">{activeCliTool.name}</span>
            </span>
          )}
          <ChevronDown
            className={cn('h-3 w-3 transition-transform opacity-60', open && 'rotate-180')}
          />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="panel-dropdown w-72 max-h-[70vh] overflow-auto">
        {/* Mode */}
        <DropdownMenuLabel className="text-[10px] uppercase tracking-wider text-muted-foreground">
          Mode
        </DropdownMenuLabel>
        {(Object.entries(modeConfig) as [SessionMode, (typeof modeConfig)[SessionMode]][]).map(
          ([key, config]) => {
            const Icon = config.icon;
            const active = mode === key;
            return (
              <DropdownMenuItem
                key={key}
                onClick={() => onModeChange(key)}
                className={cn(
                  'flex items-start gap-2.5 py-2 cursor-pointer',
                  active && 'bg-muted/60'
                )}
              >
                <Icon className={cn('h-4 w-4 mt-0.5 shrink-0', config.color)} />
                <div className="flex-1 min-w-0">
                  <div className={cn('text-xs font-medium', active && config.color)}>
                    {config.label} mode
                  </div>
                  <div className="text-[10px] text-muted-foreground leading-snug">
                    {config.description}
                  </div>
                </div>
                {active && <Check className="h-3.5 w-3.5 text-primary mt-0.5" />}
              </DropdownMenuItem>
            );
          }
        )}

        {/* Provider */}
        {providers && providers.length > 0 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Provider
            </DropdownMenuLabel>
            {providers.map((p) => {
              const active = p.id === provider;
              return (
                <DropdownMenuItem
                  key={p.id}
                  disabled={!p.available}
                  onClick={() => onProviderChange(p.id)}
                  className={cn(
                    'flex items-center gap-2.5 py-1.5 cursor-pointer',
                    active && 'bg-muted/60'
                  )}
                >
                  <span className="text-xs font-semibold w-4 text-center">
                    {CLI_PROVIDER_ICON[p.id] || p.name.slice(0, 1).toUpperCase()}
                  </span>
                  <span className="flex-1 text-xs">{p.name}</span>
                  {!p.available && (
                    <span className="text-[9px] text-muted-foreground">not installed</span>
                  )}
                  {active && <Check className="h-3.5 w-3.5 text-primary" />}
                </DropdownMenuItem>
              );
            })}
          </>
        )}

        {/* Model */}
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-[10px] uppercase tracking-wider text-muted-foreground">
          Model
        </DropdownMenuLabel>
        <DropdownMenuItem
          onClick={() => onModelChange('__default__')}
          className={cn(
            'flex items-center gap-2 py-1.5 cursor-pointer',
            modelValue === '__default__' && 'bg-muted/60'
          )}
        >
          <Sparkles className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          <span className="flex-1 text-xs">Default</span>
          {resolvedDefaultModel && (
            <span className="text-[10px] text-muted-foreground font-mono truncate max-w-[120px]">
              {modelLabels[resolvedDefaultModel] || resolvedDefaultModel}
            </span>
          )}
          {modelValue === '__default__' && <Check className="h-3.5 w-3.5 text-primary shrink-0" />}
        </DropdownMenuItem>
        {modelOptions.map((model) => {
          const active = modelValue === model;
          return (
            <DropdownMenuItem
              key={model}
              onClick={() => onModelChange(model)}
              className={cn(
                'flex items-center gap-2 py-1.5 cursor-pointer',
                active && 'bg-muted/60'
              )}
            >
              <span className="w-3.5 shrink-0" />
              <span className="flex-1 text-xs truncate">{modelLabels[model] || model}</span>
              {modelLabels[model] && (
                <span className="text-[10px] text-muted-foreground font-mono truncate max-w-[120px]">
                  {model}
                </span>
              )}
              {active && <Check className="h-3.5 w-3.5 text-primary shrink-0" />}
            </DropdownMenuItem>
          );
        })}

        {/* Reasoning/Effort */}
        {hasReasoning && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-[10px] uppercase tracking-wider text-muted-foreground">
              {reasoningLabel || 'Reasoning'}
            </DropdownMenuLabel>
            <DropdownMenuItem
              onClick={() => onReasoningChange!('__default__')}
              className={cn(
                'flex items-center gap-2 py-1.5 cursor-pointer',
                reasoningValue === '__default__' && 'bg-muted/60'
              )}
            >
              <span className="w-3.5 shrink-0" />
              <span className="flex-1 text-xs">Default</span>
              {reasoningValue === '__default__' && (
                <Check className="h-3.5 w-3.5 text-primary shrink-0" />
              )}
            </DropdownMenuItem>
            {reasoningOptions!.map((option) => {
              const active = reasoningValue === option.value;
              return (
                <DropdownMenuItem
                  key={option.value}
                  onClick={() => onReasoningChange!(option.value)}
                  className={cn(
                    'flex items-center gap-2 py-1.5 cursor-pointer',
                    active && 'bg-muted/60'
                  )}
                >
                  <span className="w-3.5 shrink-0" />
                  <span className="flex-1 text-xs">{option.label}</span>
                  {active && <Check className="h-3.5 w-3.5 text-primary shrink-0" />}
                </DropdownMenuItem>
              );
            })}
          </>
        )}

        {/* CLI Tool */}
        {hasCliTools && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-[10px] uppercase tracking-wider text-muted-foreground">
              CLI Tool
            </DropdownMenuLabel>
            <DropdownMenuItem
              onClick={() => onCliToolChange!(null)}
              className={cn(
                'flex items-center gap-2 py-1.5 cursor-pointer',
                !selectedCliTool && 'bg-muted/60'
              )}
            >
              <span className="w-3.5 shrink-0" />
              <span className="flex-1 text-xs italic text-muted-foreground">No tool</span>
              {!selectedCliTool && <Check className="h-3.5 w-3.5 text-primary shrink-0" />}
            </DropdownMenuItem>
            {cliTools!.map((tool) => {
              const active = selectedCliTool === tool.id;
              return (
                <DropdownMenuItem
                  key={tool.id}
                  onClick={() => onCliToolChange!(tool.id)}
                  className={cn(
                    'flex items-center gap-2 py-1.5 cursor-pointer',
                    active && 'bg-muted/60'
                  )}
                >
                  <Wrench className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                  <span className="flex-1 text-xs truncate">{tool.name}</span>
                  {active && <Check className="h-3.5 w-3.5 text-primary shrink-0" />}
                </DropdownMenuItem>
              );
            })}
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
