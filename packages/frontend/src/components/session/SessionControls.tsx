import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useQuery } from '@tanstack/react-query';
import { Brain, CheckCircle, Hand, Zap, ChevronDown, Activity } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { api } from '@/services/api';
import { useSessionStore } from '@/stores/sessionStore';
import { CLI_PROVIDER_LIMIT_LABELS } from '@/lib/providers';
import type { UsageData } from '@claude-code-webui/shared';

type SessionMode = 'planning' | 'auto-accept' | 'manual' | 'danger';

interface SessionControlsProps {
  mode: SessionMode;
  onModeChange: (mode: SessionMode) => void;
  usage?: UsageData;
  defaultModel?: string;
}

interface UsageLimitData {
  fiveHour: { utilization: number; resetsAt: string | null } | null;
  sevenDay: { utilization: number; resetsAt: string | null } | null;
  sevenDaySonnet: { utilization: number; resetsAt: string | null } | null;
}

interface UsageLimitsResponse {
  success: boolean;
  supported: boolean;
  provider: string;
  data: UsageLimitData | null;
}

const modeConfig: Record<
  SessionMode,
  {
    label: string;
    description: string;
    icon: typeof Brain;
    color: string;
    bgColor: string;
  }
> = {
  planning: {
    label: 'Plan Mode',
    description: 'Plans but asks before executing',
    icon: Brain,
    color: 'text-blue-500',
    bgColor: 'bg-blue-500/10 hover:bg-blue-500/20',
  },
  'auto-accept': {
    label: 'Auto Accept',
    description: 'Automatically approve safe operations',
    icon: CheckCircle,
    color: 'text-green-500',
    bgColor: 'bg-green-500/10 hover:bg-green-500/20',
  },
  manual: {
    label: 'Manual',
    description: 'Approve each operation manually',
    icon: Hand,
    color: 'text-amber-500',
    bgColor: 'bg-amber-500/10 hover:bg-amber-500/20',
  },
  danger: {
    label: 'YOLO Mode',
    description: 'Skip all confirmations (dangerous!)',
    icon: Zap,
    color: 'text-red-500',
    bgColor: 'bg-red-500/10 hover:bg-red-500/20',
  },
};

function ModeDropdown({
  mode,
  onModeChange,
}: {
  mode: SessionMode;
  onModeChange: (mode: SessionMode) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [dropdownPosition, setDropdownPosition] = useState({ top: 0, left: 0 });
  const currentMode = modeConfig[mode];
  const Icon = currentMode.icon;

  useEffect(() => {
    if (isOpen && buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      setDropdownPosition({
        top: rect.bottom + 4,
        left: rect.left,
      });
    }
  }, [isOpen]);

  const dropdown = isOpen
    ? createPortal(
        <>
          <div className="fixed inset-0 z-[100]" onClick={() => setIsOpen(false)} />
          <div
            className="glass-panel fixed z-[101] w-56 rounded-xl border-foreground/10 overflow-hidden animate-scale-in"
            style={{ top: dropdownPosition.top, left: dropdownPosition.left }}
          >
            {(Object.entries(modeConfig) as [SessionMode, (typeof modeConfig)[SessionMode]][]).map(
              ([key, config]) => {
                const ModeIcon = config.icon;
                return (
                  <button
                    key={key}
                    onClick={() => {
                      onModeChange(key);
                      setIsOpen(false);
                    }}
                    className={cn(
                      'flex items-start gap-3 w-full p-3 text-left transition-colors hover:bg-muted/50',
                      mode === key && 'bg-muted'
                    )}
                  >
                    <ModeIcon className={cn('h-4 w-4 mt-0.5 shrink-0', config.color)} />
                    <div>
                      <div className={cn('text-sm font-medium', mode === key && config.color)}>
                        {config.label}
                      </div>
                      <div className="text-xs text-muted-foreground">{config.description}</div>
                    </div>
                  </button>
                );
              }
            )}
          </div>
        </>,
        document.body
      )
    : null;

  return (
    <div className="relative">
      <Button
        ref={buttonRef}
        variant="ghost"
        size="sm"
        onClick={() => setIsOpen(!isOpen)}
        className={cn('gap-2 h-8 px-3', currentMode.bgColor, currentMode.color)}
      >
        <Icon className="h-3.5 w-3.5" />
        <span className="text-xs font-medium">{currentMode.label}</span>
        <ChevronDown className={cn('h-3 w-3 transition-transform', isOpen && 'rotate-180')} />
      </Button>
      {dropdown}
    </div>
  );
}

function formatCost(usd: number): string {
  if (usd < 0.01) {
    return `$${usd.toFixed(4)}`;
  }
  return `$${usd.toFixed(2)}`;
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function formatResetDelta(iso: string): string {
  const target = Date.parse(iso);
  if (!Number.isFinite(target)) return '';
  const diffMs = target - Date.now();
  if (diffMs <= 0) return 'now';
  const mins = Math.floor(diffMs / 60000);
  const days = Math.floor(mins / 1440);
  const hours = Math.floor((mins % 1440) / 60);
  const remainMins = mins % 60;
  if (days > 0) return `in ${days}d ${hours}h`;
  if (hours > 0) return `in ${hours}h ${remainMins}m`;
  return `in ${remainMins}m`;
}

function formatResetAbsolute(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString(undefined, {
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function getGradientColor(percent: number): string {
  const p = Math.max(0, Math.min(100, percent));
  if (p <= 50) {
    const ratio = p / 50;
    const r = Math.round(34 + (234 - 34) * ratio);
    const g = Math.round(197 + (179 - 197) * ratio);
    const b = Math.round(94 + (8 - 94) * ratio);
    return `rgb(${r}, ${g}, ${b})`;
  }
  const ratio = (p - 50) / 50;
  const r = Math.round(234 + (239 - 234) * ratio);
  const g = Math.round(179 - 179 * ratio);
  const b = Math.round(8 + (68 - 8) * ratio);
  return `rgb(${r}, ${g}, ${b})`;
}

export function ContextPopover({ usage }: { usage: UsageData }) {
  const [isOpen, setIsOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [position, setPosition] = useState({ top: 0, left: 0 });

  const { activeSessionId, sessions } = useSessionStore();
  const activeSession = sessions.find((s) => s.id === activeSessionId);
  const provider = activeSession?.cliProvider || 'claude';
  const limitsSupported =
    provider === 'claude' || provider === 'codex' || provider === 'opencode' || provider === 'vibe';

  const { data: usageLimits } = useQuery({
    queryKey: ['usage-limits', provider],
    queryFn: async () => {
      const response = await api.get<UsageLimitsResponse>(`/api/usage/limits?provider=${provider}`);
      if (response.data.success && response.data.supported && response.data.data) {
        return response.data.data;
      }
      return null;
    },
    staleTime: 60000,
    enabled: !!activeSessionId && limitsSupported,
  });

  const percent = usage.contextUsedPercent ?? 0;
  const rawPercent = usage.contextUsedPercentRaw ?? percent;
  const color = getGradientColor(percent);
  const isCritical = percent >= 95;

  // Build limit bars for popover
  const labels = CLI_PROVIDER_LIMIT_LABELS[provider];
  const limitBars: Array<{
    key: string;
    label: string;
    sublabel?: string;
    value: number;
    resetsAt: string | null;
  }> = [];
  if (usageLimits) {
    if (usageLimits.fiveHour) {
      limitBars.push({
        key: 'session',
        label: labels.session.title,
        sublabel: labels.session.subtitle,
        value: usageLimits.fiveHour.utilization,
        resetsAt: usageLimits.fiveHour.resetsAt,
      });
    }
    if (usageLimits.sevenDay && labels.weeklyAll) {
      limitBars.push({
        key: 'weekly',
        label: labels.weeklyAll.title,
        sublabel: labels.weeklyAll.subtitle,
        value: usageLimits.sevenDay.utilization,
        resetsAt: usageLimits.sevenDay.resetsAt,
      });
    }
    if (usageLimits.sevenDaySonnet && labels.weeklySonnet) {
      limitBars.push({
        key: 'sonnet',
        label: labels.weeklySonnet.title,
        sublabel: labels.weeklySonnet.subtitle,
        value: usageLimits.sevenDaySonnet.utilization,
        resetsAt: usageLimits.sevenDaySonnet.resetsAt,
      });
    }
  }

  useEffect(() => {
    if (isOpen && triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      const popoverWidth = 280;
      let left = rect.left - popoverWidth / 2 + rect.width / 2;
      left = Math.max(8, Math.min(left, window.innerWidth - popoverWidth - 8));
      setPosition({
        top: rect.bottom + 4,
        left,
      });
    }
  }, [isOpen]);

  const popover = isOpen
    ? createPortal(
        <>
          <div className="fixed inset-0 z-[100]" onClick={() => setIsOpen(false)} />
          <div
            className="glass-panel fixed z-[101] w-[280px] rounded-xl border-foreground/10 p-3 animate-scale-in"
            style={{ top: position.top, left: position.left }}
          >
            <div className="space-y-3">
              {/* Usage Limits */}
              {limitBars.length > 0 && (
                <div className="space-y-2">
                  <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                    Usage Limits
                  </div>
                  {limitBars.map((bar) => (
                    <div key={bar.key}>
                      <div className="flex justify-between text-xs mb-0.5">
                        <span className="text-muted-foreground">
                          {bar.label}
                          {bar.sublabel ? ` ${bar.sublabel}` : ''}
                        </span>
                        <span
                          className="font-mono font-medium"
                          style={{ color: getGradientColor(bar.value) }}
                        >
                          {bar.value}%
                        </span>
                      </div>
                      <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                        <div
                          className="h-full rounded-full transition-all duration-500"
                          style={{
                            width: `${Math.min(bar.value, 100)}%`,
                            backgroundColor: getGradientColor(bar.value),
                          }}
                        />
                      </div>
                      {bar.resetsAt && (
                        <div
                          className="text-[10px] text-muted-foreground mt-0.5"
                          title={`Resets ${formatResetAbsolute(bar.resetsAt)}`}
                        >
                          Resets {formatResetDelta(bar.resetsAt)}
                        </div>
                      )}
                    </div>
                  ))}
                  <div className="border-t border-border/50" />
                </div>
              )}

              {/* Context Bar */}
              <div>
                <div className="flex justify-between text-xs mb-1">
                  <span className="text-muted-foreground">Context Window</span>
                  <span className="font-mono font-medium" style={{ color }}>
                    {rawPercent.toFixed(0)}%
                  </span>
                </div>
                <div className="h-2 rounded-full bg-muted overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-500"
                    style={{ width: `${Math.min(percent, 100)}%`, backgroundColor: color }}
                  />
                </div>
                <div className="text-[10px] text-muted-foreground mt-0.5">
                  {formatTokens(usage.totalTokens)} / {formatTokens(usage.contextWindow)}
                  {usage.contextExceeded && ' (over reported window)'}
                </div>
              </div>

              {/* Token Breakdown */}
              <div className="space-y-1.5 text-xs">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Input</span>
                  <span className="font-mono">{formatTokens(usage.inputTokens)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Output</span>
                  <span className="font-mono">{formatTokens(usage.outputTokens)}</span>
                </div>
                {usage.cacheReadTokens > 0 && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Cache Read</span>
                    <span className="font-mono">{formatTokens(usage.cacheReadTokens)}</span>
                  </div>
                )}
                {usage.cacheCreationTokens > 0 && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Cache Write</span>
                    <span className="font-mono">{formatTokens(usage.cacheCreationTokens)}</span>
                  </div>
                )}
              </div>

              {/* Cost + Model */}
              <div className="pt-2 border-t border-border/50 space-y-1 text-xs">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Cost</span>
                  <span className="font-mono">{formatCost(usage.totalCostUsd)}</span>
                </div>
                {usage.model && usage.model !== 'unknown' && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Model</span>
                    <span className="font-mono truncate ml-2">{usage.model}</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        </>,
        document.body
      )
    : null;

  return (
    <>
      <button
        ref={triggerRef}
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-1.5 hover:opacity-80 transition-opacity cursor-pointer"
        title={`Context: ${rawPercent.toFixed(0)}%`}
      >
        <Activity className="h-3 w-3 text-muted-foreground" />
        <div className="w-10 h-1.5 rounded-full bg-muted overflow-hidden">
          <div
            className={cn(
              'h-full rounded-full transition-all duration-500',
              isCritical && 'animate-pulse'
            )}
            style={{ width: `${Math.min(percent, 100)}%`, backgroundColor: color }}
          />
        </div>
        <span className="text-[10px] font-mono tabular-nums" style={{ color }}>
          {rawPercent.toFixed(0)}%
        </span>
      </button>
      {popover}
    </>
  );
}

export function SessionControls({ mode, onModeChange, usage }: SessionControlsProps) {
  return (
    <div className="flex items-center gap-3 flex-wrap overflow-visible">
      {/* Mode Toggle */}
      <ModeDropdown mode={mode} onModeChange={onModeChange} />

      {/* Context Popover */}
      {usage && usage.contextWindow > 0 && (
        <>
          <div className="h-4 w-px bg-border" />
          <ContextPopover usage={usage} />
        </>
      )}
    </div>
  );
}
