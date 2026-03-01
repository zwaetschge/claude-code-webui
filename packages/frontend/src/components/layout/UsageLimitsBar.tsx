import { useQuery } from '@tanstack/react-query';
import { api } from '@/services/api';
import { useSessionStore } from '@/stores/sessionStore';
import { CLI_PROVIDER_LIMIT_LABELS } from '@/lib/providers';
import { cn } from '@/lib/utils';

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

/**
 * Interpolate color from green → yellow → red based on percentage
 */
function getGradientColor(percent: number): string {
  // Clamp between 0 and 100
  const p = Math.max(0, Math.min(100, percent));

  // Green to yellow (0-50%)
  if (p <= 50) {
    const ratio = p / 50;
    const r = Math.round(34 + (234 - 34) * ratio);   // 34 → 234
    const g = Math.round(197 + (179 - 197) * ratio); // 197 → 179
    const b = Math.round(94 + (8 - 94) * ratio);     // 94 → 8
    return `rgb(${r}, ${g}, ${b})`;
  }

  // Yellow to red (50-100%)
  const ratio = (p - 50) / 50;
  const r = Math.round(234 + (239 - 234) * ratio);  // 234 → 239
  const g = Math.round(179 - 179 * ratio);           // 179 → 0
  const b = Math.round(8 + (68 - 8) * ratio);        // 8 → 68
  return `rgb(${r}, ${g}, ${b})`;
}

interface UsageLimitsBarProps {
  className?: string;
}

export function UsageLimitsBar({ className }: UsageLimitsBarProps) {
  const { activeSessionId, sessions, usage } = useSessionStore();

  const activeSession = sessions.find((s) => s.id === activeSessionId);
  const provider = activeSession?.cliProvider || 'claude';
  const limitsSupported = provider === 'claude' || provider === 'glm' || provider === 'codex';

  // Context usage from the active session
  const currentUsage = activeSessionId ? usage[activeSessionId] : undefined;
  const contextPercent = currentUsage?.contextUsedPercent ?? 0;

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

  if (!activeSessionId || !limitsSupported || !usageLimits) {
    return null;
  }

  const labels = CLI_PROVIDER_LIMIT_LABELS[provider];

  const limits = [
    usageLimits.fiveHour && {
      key: 'session',
      label: labels.session.title,
      sublabel: labels.session.subtitle,
      value: usageLimits.fiveHour.utilization,
    },
    usageLimits.sevenDay && labels.weeklyAll && {
      key: 'weekly',
      label: labels.weeklyAll.title,
      sublabel: labels.weeklyAll.subtitle,
      value: usageLimits.sevenDay.utilization,
    },
    usageLimits.sevenDaySonnet && labels.weeklySonnet && {
      key: 'sonnet',
      label: labels.weeklySonnet.title,
      sublabel: labels.weeklySonnet.subtitle,
      value: usageLimits.sevenDaySonnet.utilization,
    },
  ].filter(Boolean) as Array<{ key: string; label: string; sublabel?: string; value: number }>;

  // Show nothing if no session
  if (!activeSessionId) {
    return null;
  }

  // All bars in one row: limits + context
  const allBars = [
    ...limits,
    {
      key: 'context',
      label: 'Context',
      sublabel: currentUsage?.totalTokens && currentUsage?.contextWindow
        ? `${formatTokens(currentUsage.totalTokens)} / ${formatTokens(currentUsage.contextWindow)}`
        : undefined,
      value: contextPercent,
    },
  ];

  return (
    <div className={cn('w-full h-5 flex gap-px bg-muted/30', className)}>
      {allBars.map((bar) => (
        <div
          key={bar.key}
          className="relative flex-1 group overflow-hidden"
        >
          {/* Background track */}
          <div className="absolute inset-0 bg-muted/40" />

          {/* Progress bar with gradient color */}
          <div
            className="absolute inset-y-0 left-0 transition-all duration-700 ease-out"
            style={{
              width: `${Math.min(100, bar.value)}%`,
              backgroundColor: getGradientColor(bar.value),
            }}
          />

          {/* Label inside the bar */}
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <span className="text-[10px] font-medium text-foreground/80 drop-shadow-sm">
              {bar.label}
              {bar.sublabel && <span className="text-foreground/60"> {bar.sublabel}</span>}
              <span className="ml-1 font-semibold">{bar.value}%</span>
            </span>
          </div>

          {/* Hover tooltip for more details */}
          <div className="absolute -bottom-8 left-1/2 -translate-x-1/2 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-50">
            <div className="bg-popover border border-border/70 rounded px-2 py-1 text-[10px] whitespace-nowrap shadow-lg">
              <span className="font-medium">{bar.label}</span>
              {bar.sublabel && <span className="text-muted-foreground"> ({bar.sublabel})</span>}
              <span className="ml-1.5 font-semibold">{bar.value}%</span>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * Format token count for display
 */
function formatTokens(count: number): string {
  if (count >= 1000000) {
    return `${(count / 1000000).toFixed(1)}M`;
  }
  if (count >= 1000) {
    return `${(count / 1000).toFixed(1)}k`;
  }
  return count.toString();
}
