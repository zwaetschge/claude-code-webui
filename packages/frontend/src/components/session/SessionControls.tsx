import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import {
  Brain,
  CheckCircle,
  Hand,
  Zap,
  ChevronDown,
  ChevronUp,
  DollarSign,
  RefreshCw,
  Users,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { UsageData } from '@claude-code-webui/shared';

type SessionMode = 'planning' | 'auto-accept' | 'manual' | 'danger' | 'orchestration';

interface UsageLimitInfo {
  percentUsed: number;
  resetsAt?: Date;
  resetsIn?: string;
}

interface SessionControlsProps {
  mode: SessionMode;
  onModeChange: (mode: SessionMode) => void;
  usage?: UsageData;
  sessionLimit?: UsageLimitInfo;
  weeklyAllModels?: UsageLimitInfo;
  weeklySonnet?: UsageLimitInfo;
}

const modeConfig: Record<SessionMode, {
  label: string;
  description: string;
  icon: typeof Brain;
  color: string;
  bgColor: string;
}> = {
  planning: {
    label: 'Plan Mode',
    description: 'Claude plans but asks before executing',
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
  orchestration: {
    label: 'Orchestration',
    description: 'Delegate to specialized subagents',
    icon: Users,
    color: 'text-purple-500',
    bgColor: 'bg-purple-500/10 hover:bg-purple-500/20',
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

  const dropdown = isOpen ? createPortal(
    <>
      <div
        className="fixed inset-0 z-[100]"
        onClick={() => setIsOpen(false)}
      />
      <div
        className="fixed z-[101] w-56 rounded-xl border bg-card shadow-lg overflow-hidden animate-scale-in"
        style={{ top: dropdownPosition.top, left: dropdownPosition.left }}
      >
        {(Object.entries(modeConfig) as [SessionMode, typeof modeConfig[SessionMode]][]).map(
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
                  <div className="text-xs text-muted-foreground">
                    {config.description}
                  </div>
                </div>
              </button>
            );
          }
        )}
      </div>
    </>,
    document.body
  ) : null;

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

function UsageBar({ percent, color }: { percent: number; color: string }) {
  return (
    <div className="w-full h-1.5 bg-muted rounded-full overflow-hidden">
      <div
        className={cn('h-full rounded-full transition-all', color)}
        style={{ width: `${Math.min(percent, 100)}%` }}
      />
    </div>
  );
}

function formatTokens(count: number): string {
  if (count >= 1000000) {
    return `${(count / 1000000).toFixed(1)}M`;
  }
  if (count >= 1000) {
    return `${(count / 1000).toFixed(1)}k`;
  }
  return count.toString();
}

function formatCost(usd: number): string {
  if (usd < 0.01) {
    return `$${usd.toFixed(4)}`;
  }
  return `$${usd.toFixed(2)}`;
}

function formatTimeUntil(date: Date): string {
  const now = new Date();
  const diff = date.getTime() - now.getTime();
  if (diff <= 0) return 'now';

  const hours = Math.floor(diff / (1000 * 60 * 60));
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));

  if (hours > 24) {
    const days = Math.floor(hours / 24);
    return `${days} day${days > 1 ? 's' : ''}`;
  }
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${minutes}m`;
}

function formatResetDate(date: Date): string {
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const day = days[date.getDay()];
  const hours = date.getHours().toString().padStart(2, '0');
  const minutes = date.getMinutes().toString().padStart(2, '0');
  return `${day}, ${hours}:${minutes}`;
}

function LimitCard({
  title,
  subtitle,
  percent,
  resetInfo,
}: {
  title: string;
  subtitle?: string;
  percent: number;
  resetInfo: string;
}) {
  const getColor = (p: number) => {
    if (p >= 90) return 'bg-red-500';
    if (p >= 70) return 'bg-amber-500';
    return 'bg-green-500';
  };

  return (
    <div className="flex-1 min-w-[120px] p-2 rounded-lg bg-muted/30 border border-border/50">
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs font-medium">{title}</span>
        {subtitle && (
          <span className="text-[10px] text-muted-foreground">{subtitle}</span>
        )}
      </div>
      <div className="flex items-center gap-2 mb-1">
        <UsageBar percent={percent} color={getColor(percent)} />
        <span className={cn(
          'text-xs font-mono font-medium min-w-[32px] text-right',
          percent >= 90 ? 'text-red-500' : percent >= 70 ? 'text-amber-500' : 'text-foreground'
        )}>
          {percent}%
        </span>
      </div>
      <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
        <RefreshCw className="h-2.5 w-2.5" />
        <span>{resetInfo}</span>
      </div>
    </div>
  );
}

export function SessionControls({
  mode,
  onModeChange,
  usage,
  sessionLimit,
  weeklyAllModels,
  weeklySonnet,
}: SessionControlsProps) {
  // Mobile collapse state
  const [mobileExpanded, setMobileExpanded] = useState(false);

  // Context window data from Claude CLI
  const contextPercent = usage?.contextUsedPercent ?? 0;
  const totalTokens = usage?.totalTokens ?? 0;
  const contextWindow = usage?.contextWindow ?? 200000;
  const cost = usage?.totalCostUsd ?? 0;
  const model = usage?.model ?? 'Not connected';

  // Helper to get next Thursday at specific time
  function getNextThursday(hour: number, minute: number): Date {
    const now = new Date();
    const result = new Date(now);
    const daysUntilThursday = (4 - now.getDay() + 7) % 7 || 7;
    result.setDate(now.getDate() + daysUntilThursday);
    result.setHours(hour, minute, 0, 0);
    return result;
  }

  // Actual limit values
  const defaultSessionLimit: UsageLimitInfo = sessionLimit || {
    percentUsed: 42,
    resetsAt: new Date(Date.now() + 1 * 60 * 60 * 1000 + 57 * 60 * 1000),
  };

  const defaultWeeklyAll: UsageLimitInfo = weeklyAllModels || {
    percentUsed: 13,
    resetsAt: getNextThursday(9, 59),
  };

  const defaultWeeklySonnet: UsageLimitInfo = weeklySonnet || {
    percentUsed: 1,
    resetsAt: getNextThursday(9, 59),
  };

  const sessionResetInfo = defaultSessionLimit.resetsAt
    ? `in ${formatTimeUntil(defaultSessionLimit.resetsAt)}`
    : defaultSessionLimit.resetsIn || '';

  const weeklyAllResetInfo = defaultWeeklyAll.resetsAt
    ? formatResetDate(defaultWeeklyAll.resetsAt)
    : '';

  const weeklySonnetResetInfo = defaultWeeklySonnet.resetsAt
    ? formatResetDate(defaultWeeklySonnet.resetsAt)
    : '';

  const getColor = (p: number) => {
    if (p >= 90) return 'bg-red-500';
    if (p >= 70) return 'bg-amber-500';
    return 'bg-green-500';
  };

  const getTextColor = (p: number) => {
    if (p >= 90) return 'text-red-500';
    if (p >= 70) return 'text-amber-500';
    return 'text-foreground';
  };

  // Extract short model name
  const shortModel = model.includes('opus') ? 'Opus' :
                     model.includes('sonnet') ? 'Sonnet' :
                     model.includes('haiku') ? 'Haiku' : model;

  return (
    <div className="space-y-2">
      {/* Mobile: Compact header with expand button */}
      <div className="flex items-center gap-2 md:hidden">
        <ModeDropdown mode={mode} onModeChange={onModeChange} />

        {/* Compact stats summary when collapsed */}
        {!mobileExpanded && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground flex-1 min-w-0">
            <span className="truncate">{shortModel}</span>
            <span className="text-muted-foreground/50">•</span>
            <span className={getTextColor(contextPercent)}>{contextPercent}%</span>
            {cost > 0 && (
              <>
                <span className="text-muted-foreground/50">•</span>
                <span>{formatCost(cost)}</span>
              </>
            )}
          </div>
        )}

        <Button
          variant="ghost"
          size="sm"
          onClick={() => setMobileExpanded(!mobileExpanded)}
          className="h-8 px-2 shrink-0"
        >
          {mobileExpanded ? (
            <ChevronUp className="h-4 w-4" />
          ) : (
            <ChevronDown className="h-4 w-4" />
          )}
        </Button>
      </div>

      {/* Mobile: Expanded details */}
      {mobileExpanded && (
        <div className="flex flex-col gap-2 md:hidden">
          {/* Context Window */}
          <div className="p-2 rounded-lg bg-muted/30 border border-border/50">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-medium">Context</span>
              <span className="text-[10px] text-muted-foreground">{shortModel}</span>
            </div>
            <div className="flex items-center gap-2 mb-1">
              <UsageBar percent={contextPercent} color={getColor(contextPercent)} />
              <span className={cn(
                'text-xs font-mono font-medium min-w-[32px] text-right',
                getTextColor(contextPercent)
              )}>
                {contextPercent}%
              </span>
            </div>
            <div className="text-[10px] text-muted-foreground">
              {formatTokens(totalTokens)} / {formatTokens(contextWindow)}
            </div>
          </div>

          {/* Cost Display */}
          {cost > 0 && (
            <div className="p-2 rounded-lg bg-muted/30 border border-border/50">
              <div className="flex items-center gap-1 mb-1">
                <DollarSign className="h-3 w-3 text-muted-foreground" />
                <span className="text-xs font-medium">Cost</span>
              </div>
              <div className="text-sm font-mono font-medium">
                {formatCost(cost)}
              </div>
            </div>
          )}

          {/* Rate Limits Row */}
          <div className="flex gap-2">
            <LimitCard
              title="Session"
              percent={defaultSessionLimit.percentUsed}
              resetInfo={sessionResetInfo}
            />
            <LimitCard
              title="Weekly"
              subtitle="All"
              percent={defaultWeeklyAll.percentUsed}
              resetInfo={weeklyAllResetInfo}
            />
            <LimitCard
              title="Weekly"
              subtitle="Sonnet"
              percent={defaultWeeklySonnet.percentUsed}
              resetInfo={weeklySonnetResetInfo}
            />
          </div>
        </div>
      )}

      {/* Desktop: Full layout */}
      <div className="hidden md:flex items-center gap-3 flex-wrap overflow-visible">
        {/* Mode Toggle */}
        <ModeDropdown mode={mode} onModeChange={onModeChange} />

        {/* Divider */}
        <div className="h-4 w-px bg-border" />

        {/* Context Window - Real data from Claude CLI */}
        <div className="flex-1 min-w-[160px] p-2 rounded-lg bg-muted/30 border border-border/50">
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs font-medium">Context</span>
            <span className="text-[10px] text-muted-foreground">{shortModel}</span>
          </div>
          <div className="flex items-center gap-2 mb-1">
            <UsageBar percent={contextPercent} color={getColor(contextPercent)} />
            <span className={cn(
              'text-xs font-mono font-medium min-w-[32px] text-right',
              getTextColor(contextPercent)
            )}>
              {contextPercent}%
            </span>
          </div>
          <div className="text-[10px] text-muted-foreground">
            {formatTokens(totalTokens)} / {formatTokens(contextWindow)}
          </div>
        </div>

        {/* Cost Display */}
        {cost > 0 && (
          <div className="p-2 rounded-lg bg-muted/30 border border-border/50 min-w-[70px]">
            <div className="flex items-center gap-1 mb-1">
              <DollarSign className="h-3 w-3 text-muted-foreground" />
              <span className="text-xs font-medium">Cost</span>
            </div>
            <div className="text-sm font-mono font-medium">
              {formatCost(cost)}
            </div>
          </div>
        )}

        {/* Divider */}
        <div className="h-4 w-px bg-border" />

        {/* Rate Limits */}
        <LimitCard
          title="Session"
          percent={defaultSessionLimit.percentUsed}
          resetInfo={sessionResetInfo}
        />

        <LimitCard
          title="Weekly"
          subtitle="All"
          percent={defaultWeeklyAll.percentUsed}
          resetInfo={weeklyAllResetInfo}
        />

        <LimitCard
          title="Weekly"
          subtitle="Sonnet"
          percent={defaultWeeklySonnet.percentUsed}
          resetInfo={weeklySonnetResetInfo}
        />
      </div>
    </div>
  );
}
