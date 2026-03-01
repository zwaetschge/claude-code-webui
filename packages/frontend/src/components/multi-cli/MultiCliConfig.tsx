import { useState, useEffect } from 'react';
import {
  Settings2,
  Crown,
  Users,
  Check,
  ChevronDown,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { CLIProvider } from '@claude-code-webui/shared';

// Available CLI providers for multi-mode (excluding multi itself)
const AVAILABLE_PROVIDERS: Array<{
  id: Exclude<CLIProvider, 'multi'>;
  name: string;
  icon: string;
  role: string;
  color: string;
}> = [
  {
    id: 'claude',
    name: 'Claude Code',
    icon: '🟠',
    role: 'Orchestrator, Planner',
    color: 'text-orange-500',
  },
  {
    id: 'codex',
    name: 'Codex',
    icon: '🟢',
    role: 'QA, Hard Coding',
    color: 'text-green-500',
  },
  {
    id: 'gemini',
    name: 'Gemini',
    icon: '🔵',
    role: 'Frontend, UI/UX',
    color: 'text-blue-500',
  },
  {
    id: 'glm',
    name: 'Z.AI',
    icon: '🔷',
    role: 'Quick Tasks',
    color: 'text-cyan-500',
  },
];

export interface MultiCliConfiguration {
  master: Exclude<CLIProvider, 'multi'>;
  slaves: Array<Exclude<CLIProvider, 'multi'>>;
}

interface MultiCliConfigProps {
  config: MultiCliConfiguration;
  onChange: (config: MultiCliConfiguration) => void;
  compact?: boolean;
}

export function MultiCliConfig({ config, onChange, compact = false }: MultiCliConfigProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  const masterProvider = AVAILABLE_PROVIDERS.find(p => p.id === config.master);
  const slaveProviders = AVAILABLE_PROVIDERS.filter(p => config.slaves.includes(p.id));

  if (compact) {
    return (
      <div className="flex items-center gap-2">
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-primary/10 hover:bg-primary/20 transition-colors"
        >
          <span className="text-lg">{masterProvider?.icon}</span>
          <Crown className="h-3 w-3 text-primary" />
          {slaveProviders.length > 0 && (
            <>
              <span className="text-muted-foreground">+</span>
              <div className="flex -space-x-1">
                {slaveProviders.map(p => (
                  <span key={p.id} className="text-sm">{p.icon}</span>
                ))}
              </div>
            </>
          )}
          <ChevronDown className={cn(
            'h-3 w-3 text-muted-foreground transition-transform',
            isExpanded && 'rotate-180'
          )} />
        </button>

        {isExpanded && (
          <div className="absolute top-full left-0 mt-2 p-3 rounded-xl border bg-card shadow-lg z-50 min-w-[280px]">
            <MultiCliConfigPanel config={config} onChange={onChange} />
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="p-4 rounded-xl border bg-card">
      <div className="flex items-center gap-2 mb-4">
        <Settings2 className="h-4 w-4 text-primary" />
        <h3 className="font-semibold text-sm">Multi-CLI Configuration</h3>
      </div>
      <MultiCliConfigPanel config={config} onChange={onChange} />
    </div>
  );
}

function MultiCliConfigPanel({
  config,
  onChange,
}: {
  config: MultiCliConfiguration;
  onChange: (config: MultiCliConfiguration) => void;
}) {
  return (
    <div className="space-y-4">
      {/* Master Selection */}
      <div>
        <div className="flex items-center gap-2 mb-2">
          <Crown className="h-3.5 w-3.5 text-amber-500" />
          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            Master Agent
          </span>
        </div>
        <div className="grid grid-cols-2 gap-2">
          {AVAILABLE_PROVIDERS.map(provider => (
            <button
              key={provider.id}
              onClick={() => {
                const newSlaves = config.slaves.filter(s => s !== provider.id);
                onChange({ master: provider.id, slaves: newSlaves });
              }}
              className={cn(
                'flex items-center gap-2 p-2 rounded-lg border transition-all',
                config.master === provider.id
                  ? 'border-primary bg-primary/10 ring-1 ring-primary'
                  : 'border-border hover:border-primary/50 hover:bg-muted/50'
              )}
            >
              <span className="text-lg">{provider.icon}</span>
              <div className="text-left flex-1 min-w-0">
                <div className="text-xs font-medium truncate">{provider.name}</div>
                <div className="text-[10px] text-muted-foreground truncate">{provider.role}</div>
              </div>
              {config.master === provider.id && (
                <Crown className="h-3 w-3 text-amber-500 shrink-0" />
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Slave Selection */}
      <div>
        <div className="flex items-center gap-2 mb-2">
          <Users className="h-3.5 w-3.5 text-blue-500" />
          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            Slave Agents
          </span>
        </div>
        <div className="grid grid-cols-2 gap-2">
          {AVAILABLE_PROVIDERS.filter(p => p.id !== config.master).map(provider => {
            const isSelected = config.slaves.includes(provider.id);
            return (
              <button
                key={provider.id}
                onClick={() => {
                  const newSlaves = isSelected
                    ? config.slaves.filter(s => s !== provider.id)
                    : [...config.slaves, provider.id];
                  onChange({ ...config, slaves: newSlaves });
                }}
                className={cn(
                  'flex items-center gap-2 p-2 rounded-lg border transition-all',
                  isSelected
                    ? 'border-blue-500 bg-blue-500/10 ring-1 ring-blue-500'
                    : 'border-border hover:border-blue-500/50 hover:bg-muted/50'
                )}
              >
                <span className="text-lg">{provider.icon}</span>
                <div className="text-left flex-1 min-w-0">
                  <div className="text-xs font-medium truncate">{provider.name}</div>
                  <div className="text-[10px] text-muted-foreground truncate">{provider.role}</div>
                </div>
                {isSelected && (
                  <Check className="h-3 w-3 text-blue-500 shrink-0" />
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Summary */}
      <div className="pt-3 border-t">
        <div className="text-xs text-muted-foreground">
          <span className="font-medium">Active:</span>{' '}
          {AVAILABLE_PROVIDERS.find(p => p.id === config.master)?.name} (Master)
          {config.slaves.length > 0 && (
            <>
              {' + '}
              {config.slaves.map(s => AVAILABLE_PROVIDERS.find(p => p.id === s)?.name).join(', ')}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// Hook for managing multi-cli config in localStorage
export function useMultiCliConfig(sessionId?: string): [MultiCliConfiguration, (config: MultiCliConfiguration) => void] {
  const storageKey = sessionId ? `multiCliConfig:${sessionId}` : 'multiCliConfig:default';

  const [config, setConfig] = useState<MultiCliConfiguration>(() => {
    if (typeof window === 'undefined') {
      return { master: 'claude', slaves: ['codex', 'gemini'] };
    }
    const stored = localStorage.getItem(storageKey);
    if (stored) {
      try {
        return JSON.parse(stored);
      } catch {
        // ignore
      }
    }
    return { master: 'claude', slaves: ['codex', 'gemini'] };
  });

  useEffect(() => {
    if (typeof window !== 'undefined') {
      localStorage.setItem(storageKey, JSON.stringify(config));
    }
  }, [config, storageKey]);

  return [config, setConfig];
}
