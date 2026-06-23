import { useCallback, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  BarChart3,
  Coins,
  Cpu,
  Database,
  Layers,
  Sparkles,
  Gauge,
  Clock,
  Calendar,
  Zap,
  AlertCircle,
  Loader2,
  FileJson,
  FileSpreadsheet,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { api } from '@/services/api';
import { cn } from '@/lib/utils';
import {
  CLI_PROVIDER_LABEL,
  CLI_PROVIDER_LIMIT_LABELS,
  type CLIProvider,
  type UiProvider,
} from '@/lib/providers';
import { ProviderLogo } from '@/components/branding/ProviderLogo';
import { getProviderLabelForModel } from '@plum-code-webui/shared';

interface ApiResponse<T> {
  success: boolean;
  data: T;
}

interface LimitWindowData {
  utilization: number;
  resetsAt: string | null;
  windowSeconds?: number | null;
  used?: number | null;
  limit?: number | null;
  remaining?: number | null;
  unit?: string | null;
}

interface AnalyticsSummary {
  period: string;
  window?: {
    period: string;
    startsAt: string | null;
    endsAt: string | null;
    source: 'rolling' | 'calendar-week' | 'calendar-month' | 'all';
    label: string;
    offset: number;
    canGoPrevious: boolean;
    canGoNext: boolean;
    timezoneOffsetMinutes: number;
    limit: {
      provider: 'codex';
      name: 'weekly';
      utilization: number;
      resetsAt: string | null;
      windowSeconds: number | null;
    } | null;
  };
  totals: {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheCreationTokens: number;
    totalTokens: number;
    totalCost: number;
    recordedCost: number;
    apiEquivalentCost: number;
    theoreticalCost: number;
    costDelta: number;
    pricedTokens: number;
    unpricedTokens: number;
    pricingCoveragePercent: number;
    totalRequests: number;
  };
  byModel: Array<{
    model: string | null;
    provider: string;
    input_tokens: number;
    output_tokens: number;
    cache_read_tokens: number;
    cache_creation_tokens: number;
    total_tokens: number;
    cost: number;
    recorded_cost: number;
    api_equivalent_cost: number;
    theoretical_cost: number;
    cost_delta: number;
    pricing_known: boolean;
    pricing_source: string | null;
    pricing_label: string | null;
    pricing: {
      input: number;
      output: number;
      cacheRead: number;
      cacheWrite: number;
    } | null;
    requests: number;
    first_seen: string | null;
    last_seen: string | null;
  }>;
  byProvider: Array<{
    provider: string;
    input_tokens: number;
    output_tokens: number;
    cache_read_tokens: number;
    cache_creation_tokens: number;
    total_tokens: number;
    cost: number;
    recorded_cost: number;
    api_equivalent_cost: number;
    theoretical_cost: number;
    cost_delta: number;
    requests: number;
    priced_tokens: number;
    unpriced_tokens: number;
    models: number;
  }>;
  bySession: Array<{
    session_id: string;
    session_name: string;
    total_tokens: number;
    cost: number;
    api_equivalent_cost?: number;
    theoretical_cost?: number;
    recorded_cost?: number;
    cost_delta?: number;
    requests: number;
  }>;
  pricingAudit: {
    recordedCost: number;
    apiEquivalentCost: number;
    theoreticalCost: number;
    delta: number;
    pricedTokens: number;
    unpricedTokens: number;
    coveragePercent: number;
    missingPricingModels: Array<{
      model: string;
      provider: string;
      tokens: number;
      requests: number;
    }>;
  };
  events?: {
    contextSnapshots: number;
    compactEvents: number;
    latestContext: {
      sessionId: string;
      provider: string | null;
      model: string | null;
      inputTokens: number;
      outputTokens: number;
      cacheReadTokens: number;
      cacheCreationTokens: number;
      totalTokens: number;
      contextWindow: number;
      contextUsedPercent: number;
      contextExceeded: boolean;
      createdAt: string;
    } | null;
  };
}

interface TimelineData {
  date: string;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_creation_tokens: number;
  total_tokens: number;
  cost: number;
  requests: number;
  providers?: Record<string, { tokens: number; cost: number; requests: number }>;
  models?: Record<
    string,
    { model: string; provider: string; tokens: number; cost: number; requests: number }
  >;
  context_snapshots?: number;
  compact_events?: number;
  max_context_used_percent?: number | null;
}

interface ProviderStats {
  provider: string;
  cost: number;
  theoreticalCost: number;
  tokens: number;
  requests: number;
  unpricedTokens: number;
  models: Array<{
    model: string;
    cost: number;
    theoreticalCost: number;
    tokens: number;
    requests: number;
    pricingKnown?: boolean;
  }>;
}

interface UsageLimitData {
  subscriptionType?: string;
  rateLimitTier?: string;
  fiveHour: LimitWindowData | null;
  sevenDay: LimitWindowData | null;
  sevenDaySonnet: LimitWindowData | null;
  additional?: Array<{ name: string } & LimitWindowData>;
  source?: 'upstream' | 'local-budget' | 'local-estimate';
  localBudget?: {
    dailyUsd: number | null;
    weeklyUsd: number | null;
    dailySpendUsd: number;
    weeklySpendUsd: number;
    dailyTokens: number;
    weeklyTokens: number;
    dailyRequests: number;
    weeklyRequests: number;
  };
}

interface UsageLimitsResponse {
  success: boolean;
  supported: boolean;
  provider: UsageLimitProvider;
  data: UsageLimitData | null;
  error?: { code: string; message: string };
}

type UsageLimitProvider = CLIProvider | 'z-ai' | 'opencode-go';

const USAGE_PROVIDERS: UsageLimitProvider[] = [
  'codex',
  'z-ai',
  'opencode-go',
  'opencode',
  'vibe',
  'claude',
];

const USAGE_PROVIDER_COLORS: Record<UsageLimitProvider, string> = {
  claude: '#f97316',
  codex: '#22c55e',
  opencode: '#3b82f6',
  'opencode-go': '#2563eb',
  vibe: '#fa520f',
  'z-ai': '#0f766e',
};

const USAGE_PROVIDER_LABELS: Record<UsageLimitProvider, string> = {
  ...CLI_PROVIDER_LABEL,
  'opencode-go': 'OpenCode Go',
  'z-ai': 'Z.ai Coding Plan',
};

const USAGE_PROVIDER_LOGO: Record<UsageLimitProvider, UiProvider> = {
  claude: 'claude',
  codex: 'codex',
  opencode: 'opencode',
  'opencode-go': 'opencode',
  vibe: 'vibe',
  'z-ai': 'opencode',
};

const USAGE_LIMIT_LABELS: Record<
  UsageLimitProvider,
  {
    session: { title: string; subtitle?: string };
    weeklyAll?: { title: string; subtitle?: string };
    weeklySonnet?: { title: string; subtitle?: string };
  }
> = {
  ...CLI_PROVIDER_LIMIT_LABELS,
  'opencode-go': {
    session: { title: 'Rolling', subtitle: 'Go quota' },
    weeklyAll: { title: 'Weekly', subtitle: 'Go quota' },
  },
  'z-ai': {
    session: { title: '5h', subtitle: 'Tokens' },
    weeklyAll: { title: 'Weekly', subtitle: 'Tokens' },
  },
};

const PERIODS = [
  { value: '24h', label: '24h' },
  { value: '7d', label: 'Weekly' },
  { value: '30d', label: 'Monthly' },
  { value: 'all', label: 'All' },
];

const CHART_METRICS = [
  { value: 'tokens', label: 'Tokens' },
  { value: 'cost', label: 'Cost' },
  { value: 'requests', label: 'Requests' },
] as const;

type ChartMetric = (typeof CHART_METRICS)[number]['value'];

const TOKEN_COLORS = {
  input: '#6b7280',
  output: '#a3a3a3',
  cacheRead: '#9ca3af',
  cacheCreate: '#e5e7eb',
};

const PROVIDER_FALLBACK_COLOR = '#94a3b8';

const PROVIDER_COLORS: Record<string, string> = {
  Codex: '#22c55e',
  OpenCode: '#3b82f6',
  Vibe: '#fa520f',
  Claude: '#f97316',
  Other: PROVIDER_FALLBACK_COLOR,
};

const MODEL_COLORS = [
  '#2563eb',
  '#16a34a',
  '#dc2626',
  '#9333ea',
  '#0891b2',
  '#ea580c',
  '#4f46e5',
  '#0d9488',
  '#be123c',
  '#65a30d',
  '#7c3aed',
  '#ca8a04',
  '#0284c7',
  '#c026d3',
  '#059669',
  '#e11d48',
];

function withAlpha(hex: string, alpha: string): string {
  const normalized = hex.startsWith('#') ? hex.slice(1) : hex;
  if (normalized.length !== 6) return hex;
  return `#${normalized}${alpha}`;
}

function getProviderColor(provider?: string): string {
  return PROVIDER_COLORS[provider || ''] ?? PROVIDER_FALLBACK_COLOR;
}

function formatNumber(num: number): string {
  if (num >= 1_000_000) {
    return (num / 1_000_000).toFixed(1) + 'M';
  }
  if (num >= 1_000) {
    return (num / 1_000).toFixed(1) + 'K';
  }
  return num.toLocaleString();
}

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  }).format(amount);
}

function formatSignedCurrency(amount: number): string {
  const formatted = formatCurrency(Math.abs(amount));
  if (Math.abs(amount) < 0.00005) return formatCurrency(0);
  return `${amount > 0 ? '+' : '-'}${formatted}`;
}

function formatRate(value?: number): string {
  if (value === undefined || value === null) return '-';
  return `$${value.toLocaleString('en-US', { maximumFractionDigits: 4 })}/M`;
}

function formatLimitAmount(value?: number | null, unit?: string | null): string {
  if (value === undefined || value === null || !Number.isFinite(value)) return '';
  if (unit === 'usd') return formatCurrency(value);
  if (unit === 'tokens') return `${formatNumber(value)} tokens`;
  if (unit === 'requests') return `${formatNumber(value)} requests`;
  if (unit === 'percent') return `${value.toLocaleString('en-US', { maximumFractionDigits: 0 })}%`;
  return formatNumber(value);
}

function formatLimitUsage(limit: LimitWindowData): string | null {
  if (
    limit.used === undefined ||
    limit.used === null ||
    limit.limit === undefined ||
    limit.limit === null
  ) {
    return null;
  }
  const used = formatLimitAmount(limit.used, limit.unit);
  const total = formatLimitAmount(limit.limit, limit.unit);
  if (!used || !total) return null;
  return `${used} / ${total}`;
}

function formatLimitSource(source?: UsageLimitData['source']): string {
  if (source === 'local-estimate') return 'Local estimate';
  if (source === 'local-budget') return 'Local budget';
  return 'Live quota';
}

function getModelKey(model: string, index: number): string {
  const normalized = model
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return `model_${index}_${normalized || 'unknown'}`;
}

function getModelColor(model: string, index: number): string {
  if (index < MODEL_COLORS.length) return MODEL_COLORS[index] || PROVIDER_FALLBACK_COLOR;
  let hash = 0;
  for (let i = 0; i < model.length; i += 1) {
    hash = (hash * 31 + model.charCodeAt(i)) >>> 0;
  }
  return MODEL_COLORS[hash % MODEL_COLORS.length] || PROVIDER_FALLBACK_COLOR;
}

function formatChartValue(metric: ChartMetric, value: number): string {
  if (metric === 'cost') return formatCurrency(value);
  if (metric === 'requests') return value.toLocaleString();
  return formatNumber(value);
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
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatWindowDate(iso?: string | null): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatWindowRange(startsAt?: string | null, endsAt?: string | null): string {
  if (!startsAt && !endsAt) return 'all recorded usage';
  const start = formatWindowDate(startsAt);
  const end = formatWindowDate(endsAt);
  if (start && end) return `${start} - ${end}`;
  return start ? `since ${start}` : `until ${end}`;
}

function parseTimelineLabel(value: string): Date | null {
  const match = value.match(/^(\d{4})-(\d{2})(?:-(\d{2})(?:\s+(\d{2}):00)?)?$/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]) - 1;
  const day = match[3] ? Number(match[3]) : 1;
  const hour = match[4] ? Number(match[4]) : 0;
  const date = new Date(year, month, day, hour);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatTimelineLabel(value: string): string {
  const date = parseTimelineLabel(value);
  if (!date) return value;
  if (/^\d{4}-\d{2}$/.test(value)) {
    return date.toLocaleDateString(undefined, { month: 'short', year: '2-digit' });
  }
  if (/\d{2}:00$/.test(value)) {
    return date.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit' });
  }
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function LimitResetLine({ resetsAt }: { resetsAt?: string | null }) {
  if (!resetsAt) return null;
  return (
    <p className="text-[11px] text-muted-foreground">
      Reset {formatResetDelta(resetsAt)} · {formatResetAbsolute(resetsAt)}
    </p>
  );
}

// Signed minute offset from UTC — positive east. Berlin (UTC+2) = 120.
// Counter-signs `Date.getTimezoneOffset()` which returns offset-from-local-to-UTC.
function getTzOffsetMinutes(): number {
  return -new Date().getTimezoneOffset();
}

const TOP_SESSIONS_PAGE_SIZE = 10;

function triggerDownload(content: string, filename: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function csvEscape(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';
  const str = String(value);
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function buildTimelineCsv(rows: TimelineData[]): string {
  const header = [
    'date',
    'input_tokens',
    'output_tokens',
    'cache_read_tokens',
    'cache_creation_tokens',
    'total_tokens',
    'cost',
    'requests',
    'context_snapshots',
    'compact_events',
    'max_context_used_percent',
    'models_json',
  ];
  const lines = [header.join(',')];
  for (const row of rows) {
    lines.push(
      [
        csvEscape(row.date),
        row.input_tokens,
        row.output_tokens,
        row.cache_read_tokens,
        row.cache_creation_tokens,
        row.total_tokens,
        row.cost,
        row.requests,
        row.context_snapshots ?? 0,
        row.compact_events ?? 0,
        row.max_context_used_percent ?? '',
        csvEscape(row.models ? JSON.stringify(row.models) : ''),
      ].join(',')
    );
  }
  return lines.join('\n');
}

export function AnalyticsPage() {
  const [period, setPeriod] = useState('7d');
  const [periodOffset, setPeriodOffset] = useState(0);
  const [chartMetric, setChartMetric] = useState<ChartMetric>('tokens');
  const [topSessionsLimit, setTopSessionsLimit] = useState(TOP_SESSIONS_PAGE_SIZE);
  // Capture the offset once per mount so query keys stay stable even if the system clock
  // nudges (e.g. DST rollover mid-session would otherwise refetch every render).
  const tzOffsetRef = useRef(getTzOffsetMinutes());
  const tzOffset = tzOffsetRef.current;

  const {
    data: summary,
    isLoading: summaryLoading,
    isError: summaryError,
    error: summaryErrorObj,
  } = useQuery({
    queryKey: ['analytics-summary', period, periodOffset, tzOffset],
    queryFn: async () => {
      const response = await api.get<ApiResponse<AnalyticsSummary>>(
        `/api/analytics/summary?period=${period}&tz=${tzOffset}&offset=${periodOffset}`
      );
      return response.data.data;
    },
  });

  const {
    data: timeline,
    isLoading: timelineLoading,
    isError: timelineError,
  } = useQuery({
    queryKey: ['analytics-timeline', period, periodOffset, tzOffset],
    queryFn: async () => {
      const response = await api.get<ApiResponse<TimelineData[]>>(
        `/api/analytics/timeline?period=${period}&tz=${tzOffset}&offset=${periodOffset}`
      );
      return response.data.data;
    },
  });

  // Fetch usage limits for all supported providers
  const usageLimitsQueries = USAGE_PROVIDERS.map((prov) => {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    return useQuery({
      queryKey: ['usage-limits', prov],
      queryFn: async () => {
        const response = await api.get<UsageLimitsResponse>(`/api/usage/limits?provider=${prov}`);
        return { cliProvider: prov, ...response.data };
      },
      staleTime: 60000, // 1 minute
      refetchInterval: 300000, // 5 minutes — quotas shift; don't keep stale values on screen
      retry: 1,
    });
  });

  const usageLimitsData = usageLimitsQueries
    .filter((q) => q.data?.success && q.data?.supported && q.data?.data)
    .map((q) => ({
      provider: q.data!.cliProvider,
      data: q.data!.data!,
      error: q.data!.error,
    }));

  const usageLimitsLoading = usageLimitsQueries.some((q) => q.isLoading);

  const isLoading = summaryLoading || timelineLoading;
  const hasError = summaryError || timelineError;
  const errorMessage =
    summaryErrorObj instanceof Error ? summaryErrorObj.message : 'Analytics failed to load';
  const totalTokens = summary?.totals.totalTokens || 0;
  const totalCost = summary?.totals.totalCost || 0;
  const apiEquivalentCost = summary?.totals.apiEquivalentCost ?? totalCost;
  const costDelta = summary?.totals.costDelta ?? 0;
  const pricingCoveragePercent = summary?.totals.pricingCoveragePercent ?? 100;
  const unpricedTokens = summary?.totals.unpricedTokens ?? 0;
  const totalRequests = summary?.totals.totalRequests || 0;
  const avgCost = totalRequests > 0 ? totalCost / totalRequests : 0;
  const avgTokens = totalRequests > 0 ? totalTokens / totalRequests : 0;
  const effectiveCostPerMillion = totalTokens > 0 ? (totalCost / totalTokens) * 1_000_000 : 0;
  const promptTokens =
    (summary?.totals.inputTokens || 0) +
    (summary?.totals.cacheReadTokens || 0) +
    (summary?.totals.cacheCreationTokens || 0);
  const cacheHitRate =
    summary && promptTokens > 0
      ? Math.round((summary.totals.cacheReadTokens / promptTokens) * 100)
      : 0;
  const analyticsWindow = summary?.window;
  const windowLimit = analyticsWindow?.limit;
  const contextSnapshots = summary?.events?.contextSnapshots ?? 0;
  const compactEvents = summary?.events?.compactEvents ?? 0;
  const latestContextPercent = summary?.events?.latestContext?.contextUsedPercent ?? 0;

  const handlePeriodChange = useCallback((next: string) => {
    setPeriod(next);
    setPeriodOffset(0);
    setTopSessionsLimit(TOP_SESSIONS_PAGE_SIZE);
  }, []);

  const exportJson = useCallback(() => {
    if (!summary && !timeline) return;
    const payload = {
      period,
      offset: periodOffset,
      exportedAt: new Date().toISOString(),
      tzOffsetMinutes: tzOffset,
      summary: summary ?? null,
      timeline: timeline ?? [],
    };
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    triggerDownload(
      JSON.stringify(payload, null, 2),
      `analytics-${period}-offset-${periodOffset}-${stamp}.json`,
      'application/json'
    );
  }, [summary, timeline, period, periodOffset, tzOffset]);

  const exportCsv = useCallback(() => {
    if (!timeline || timeline.length === 0) return;
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    triggerDownload(
      buildTimelineCsv(timeline),
      `analytics-${period}-offset-${periodOffset}-${stamp}.csv`,
      'text/csv'
    );
  }, [timeline, period, periodOffset]);

  const tokenBreakdown = useMemo(() => {
    if (!summary) return [];
    return [
      {
        key: 'input',
        label: 'Input',
        value: summary.totals.inputTokens,
        color: TOKEN_COLORS.input,
      },
      {
        key: 'output',
        label: 'Output',
        value: summary.totals.outputTokens,
        color: TOKEN_COLORS.output,
      },
      {
        key: 'cacheRead',
        label: 'Cache Read',
        value: summary.totals.cacheReadTokens,
        color: TOKEN_COLORS.cacheRead,
      },
      {
        key: 'cacheCreate',
        label: 'Cache Create',
        value: summary.totals.cacheCreationTokens,
        color: TOKEN_COLORS.cacheCreate,
      },
    ].filter((item) => item.value > 0);
  }, [summary]);

  const providerSummary = useMemo<ProviderStats[]>(() => {
    if (!summary?.byModel?.length) return [];
    const map = new Map<string, ProviderStats>();
    summary.byModel.forEach((model) => {
      const provider = model.provider || getProviderLabelForModel(model.model);
      const current = map.get(provider) || {
        provider,
        cost: 0,
        theoreticalCost: 0,
        tokens: 0,
        requests: 0,
        unpricedTokens: 0,
        models: [],
      };
      current.cost += model.cost;
      current.theoreticalCost += model.api_equivalent_cost ?? model.theoretical_cost;
      current.tokens += model.total_tokens;
      current.requests += model.requests;
      if (!model.pricing_known) current.unpricedTokens += model.total_tokens;
      current.models.push({
        model: model.model || 'Unknown',
        cost: model.cost,
        theoreticalCost: model.api_equivalent_cost ?? model.theoretical_cost,
        tokens: model.total_tokens,
        requests: model.requests,
        pricingKnown: model.pricing_known,
      });
      map.set(provider, current);
    });
    return Array.from(map.values())
      .map((entry) => ({
        ...entry,
        models: entry.models.sort((a, b) => b.cost - a.cost).slice(0, 3),
      }))
      .sort((a, b) => b.cost - a.cost);
  }, [summary]);

  const modelSeries = useMemo(() => {
    if (!summary?.byModel?.length) return [];
    return summary.byModel.map((model, index) => {
      const modelName = model.model || 'Unknown';
      return {
        key: getModelKey(modelName, index),
        label: modelName,
        model: modelName,
        provider: model.provider || getProviderLabelForModel(model.model),
        color: getModelColor(modelName, index),
        fillOpacity: 0.28,
      };
    });
  }, [summary]);

  const fallbackSeries = useMemo(() => {
    if (chartMetric === 'tokens') {
      return [
        {
          key: 'input_tokens',
          label: 'Input',
          color: TOKEN_COLORS.input,
          fillOpacity: 0.25,
        },
        {
          key: 'output_tokens',
          label: 'Output',
          color: TOKEN_COLORS.output,
          fillOpacity: 0.45,
        },
      ];
    }
    if (chartMetric === 'cost') {
      return [
        {
          key: 'cost',
          label: 'Cost',
          color: TOKEN_COLORS.cacheCreate,
          fillOpacity: 0.35,
        },
      ];
    }
    return [
      {
        key: 'requests',
        label: 'Requests',
        color: TOKEN_COLORS.cacheRead,
        fillOpacity: 0.35,
      },
    ];
  }, [chartMetric]);

  const chartSeries = modelSeries.length > 0 ? modelSeries : fallbackSeries;

  const chartData = useMemo(() => {
    if (!timeline || timeline.length === 0) return [];
    if (modelSeries.length === 0) {
      return timeline;
    }
    return timeline.map((entry) => {
      const models = entry.models || {};
      const dataPoint: Record<string, number | string> = { date: entry.date };
      modelSeries.forEach((series) => {
        const stats = models[series.model];
        let value = 0;
        if (chartMetric === 'cost') {
          value = stats?.cost ?? 0;
        } else if (chartMetric === 'requests') {
          value = stats?.requests ?? 0;
        } else {
          value = stats?.tokens ?? 0;
        }
        dataPoint[series.key] = value;
      });
      return dataPoint;
    });
  }, [timeline, modelSeries, chartMetric]);

  return (
    <div className="analytics-shell glass-page analytics-dashboard container mx-auto">
      <div className="analytics-hero">
        <div className="analytics-hero-copy">
          <div className="analytics-eyebrow">
            <BarChart3 className="h-4 w-4" />
            Unified Analytics
          </div>
          <h1>All providers. One ledger.</h1>
          <p>
            Token volume and API-equivalent spend across every connected coding provider.
          </p>
          <div className="analytics-provider-pills">
            {providerSummary.length === 0 ? (
              <span className="ui-pill ui-pill-subtle">All providers</span>
            ) : (
              providerSummary.map((provider) => {
                const color = getProviderColor(provider.provider);
                return (
                  <span
                    key={provider.provider}
                    className="ui-pill ui-pill-subtle text-foreground"
                    style={{
                      borderColor: withAlpha(color, '66'),
                      backgroundColor: withAlpha(color, '14'),
                    }}
                  >
                    <span className="h-2 w-2 rounded-full" style={{ backgroundColor: color }} />
                    {provider.provider}
                  </span>
                );
              })
            )}
          </div>
          {analyticsWindow && (
            <div className="analytics-window-row">
              <span className="ui-pill ui-pill-subtle">
                <Calendar className="h-3.5 w-3.5" />
                {analyticsWindow.label}:{' '}
                {formatWindowRange(analyticsWindow.startsAt, analyticsWindow.endsAt)}
              </span>
              {windowLimit && (
                <span className="ui-pill ui-pill-subtle border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300">
                  <Gauge className="h-3.5 w-3.5" />
                  Codex weekly {windowLimit.utilization}%
                  {windowLimit.resetsAt && <> · reset {formatResetDelta(windowLimit.resetsAt)}</>}
                </span>
              )}
            </div>
          )}
        </div>
        <div className="analytics-hero-actions">
          <div role="radiogroup" aria-label="Time period" className="analytics-control-group">
            {PERIODS.map((p, idx) => (
              <button
                key={p.value}
                type="button"
                role="radio"
                aria-checked={period === p.value}
                tabIndex={period === p.value ? 0 : -1}
                onClick={() => handlePeriodChange(p.value)}
                onKeyDown={(e) => {
                  if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
                    e.preventDefault();
                    const next = PERIODS[(idx + 1) % PERIODS.length];
                    if (next) handlePeriodChange(next.value);
                  } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
                    e.preventDefault();
                    const prev = PERIODS[(idx - 1 + PERIODS.length) % PERIODS.length];
                    if (prev) handlePeriodChange(prev.value);
                  }
                }}
                className={cn(
                  'ui-pill ui-pill-subtle transition-colors',
                  period === p.value && 'bg-foreground text-background border-transparent'
                )}
              >
                {p.label}
              </button>
            ))}
          </div>
          <div className="analytics-control-group">
            <button
              type="button"
              onClick={() => setPeriodOffset((value) => value + 1)}
              disabled={period === 'all'}
              className="ui-pill ui-pill-subtle transition-colors hover:bg-muted disabled:opacity-40 disabled:pointer-events-none"
              title="Show previous time window"
              aria-label="Show previous time window"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
              <span>Previous</span>
            </button>
            <button
              type="button"
              onClick={() => setPeriodOffset(0)}
              disabled={period === 'all' || periodOffset === 0}
              className="ui-pill ui-pill-subtle transition-colors hover:bg-muted disabled:opacity-40 disabled:pointer-events-none"
              title="Jump to current time window"
              aria-label="Jump to current time window"
            >
              <span>Current</span>
            </button>
            <button
              type="button"
              onClick={() => setPeriodOffset((value) => Math.max(0, value - 1))}
              disabled={period === 'all' || periodOffset === 0}
              className="ui-pill ui-pill-subtle transition-colors hover:bg-muted disabled:opacity-40 disabled:pointer-events-none"
              title="Show next time window"
              aria-label="Show next time window"
            >
              <span>Next</span>
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="analytics-control-group">
            <button
              type="button"
              onClick={exportCsv}
              disabled={!timeline || timeline.length === 0}
              className="ui-pill ui-pill-subtle transition-colors hover:bg-muted disabled:opacity-40 disabled:pointer-events-none"
              title="Export timeline as CSV"
              aria-label="Export timeline as CSV"
            >
              <FileSpreadsheet className="h-3.5 w-3.5" />
              <span>CSV</span>
            </button>
            <button
              type="button"
              onClick={exportJson}
              disabled={!summary && !timeline}
              className="ui-pill ui-pill-subtle transition-colors hover:bg-muted disabled:opacity-40 disabled:pointer-events-none"
              title="Export analytics as JSON"
              aria-label="Export analytics as JSON"
            >
              <FileJson className="h-3.5 w-3.5" />
              <span>JSON</span>
            </button>
          </div>
        </div>
      </div>

      {hasError && (
        <div className="flex items-center gap-3 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>{errorMessage}</span>
        </div>
      )}

      {/* Provider Usage Limits */}
      {usageLimitsData.length > 0 && (
        <Card className="analytics-quota-panel">
          <CardHeader className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div>
              <CardTitle className="flex items-center gap-2 text-lg">
                <Gauge className="h-5 w-5" />
                Provider Limits
              </CardTitle>
              <CardDescription>Usage limits and quotas per provider</CardDescription>
            </div>
            {usageLimitsLoading && (
              <div className="ui-pill ui-pill-subtle">
                <div className="animate-spin h-3 w-3 border-2 border-muted-foreground border-t-transparent rounded-full" />
                Refreshing
              </div>
            )}
          </CardHeader>
          <CardContent>
            <div className="analytics-quota-grid">
              {usageLimitsData.map(({ provider, data, error }) => {
                const color = USAGE_PROVIDER_COLORS[provider] || PROVIDER_FALLBACK_COLOR;
                const labels = USAGE_LIMIT_LABELS[provider];
                const providerName = USAGE_PROVIDER_LABELS[provider];
                const logoProvider = USAGE_PROVIDER_LOGO[provider];

                return (
                  <div
                    key={provider}
                    className="analytics-quota-card"
                    style={{ '--analytics-provider-color': color } as CSSProperties}
                  >
                    <div className="flex items-center gap-3">
                      <ProviderLogo provider={logoProvider} className="h-6 w-6" />
                      <div>
                        <h3 className="text-sm font-semibold">{providerName}</h3>
                        <p className="text-xs text-muted-foreground">
                          {data.subscriptionType || data.rateLimitTier || 'Rate limits'}
                        </p>
                      </div>
                      <span className="ml-auto rounded-md border border-border/70 px-2 py-1 text-[10px] uppercase tracking-wide text-muted-foreground">
                        {formatLimitSource(data.source)}
                      </span>
                    </div>

                    {error && (
                      <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
                        <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                        <span>{error.message}</span>
                      </div>
                    )}

                    <div className="space-y-3">
                      {/* Session / 5h limit */}
                      {data.fiveHour && (
                        <div className="space-y-1.5">
                          <div className="flex items-center justify-between text-xs">
                            <span className="flex items-center gap-1.5 text-muted-foreground">
                              <Clock className="h-3 w-3" />
                              {labels.session.title}
                              {labels.session.subtitle && (
                                <span className="text-muted-foreground/60">
                                  ({labels.session.subtitle})
                                </span>
                              )}
                            </span>
                            <span className="font-medium">{data.fiveHour.utilization}%</span>
                          </div>
                          <div className="h-2 bg-muted rounded-full overflow-hidden">
                            <div
                              className="h-full rounded-full transition-all duration-500"
                              style={{
                                width: `${Math.min(100, data.fiveHour.utilization)}%`,
                                backgroundColor: data.fiveHour.utilization > 80 ? '#ef4444' : color,
                              }}
                            />
                          </div>
                          {formatLimitUsage(data.fiveHour) && (
                            <p className="text-[11px] text-muted-foreground">
                              {formatLimitUsage(data.fiveHour)}
                            </p>
                          )}
                          <LimitResetLine resetsAt={data.fiveHour.resetsAt} />
                        </div>
                      )}

                      {/* Weekly all models */}
                      {data.sevenDay && labels.weeklyAll && (
                        <div className="space-y-1.5">
                          <div className="flex items-center justify-between text-xs">
                            <span className="flex items-center gap-1.5 text-muted-foreground">
                              <Calendar className="h-3 w-3" />
                              {labels.weeklyAll.title}
                              {labels.weeklyAll.subtitle && (
                                <span className="text-muted-foreground/60">
                                  ({labels.weeklyAll.subtitle})
                                </span>
                              )}
                            </span>
                            <span className="font-medium">{data.sevenDay.utilization}%</span>
                          </div>
                          <div className="h-2 bg-muted rounded-full overflow-hidden">
                            <div
                              className="h-full rounded-full transition-all duration-500"
                              style={{
                                width: `${Math.min(100, data.sevenDay.utilization)}%`,
                                backgroundColor:
                                  data.sevenDay.utilization > 80
                                    ? '#ef4444'
                                    : withAlpha(color, 'cc'),
                              }}
                            />
                          </div>
                          {formatLimitUsage(data.sevenDay) && (
                            <p className="text-[11px] text-muted-foreground">
                              {formatLimitUsage(data.sevenDay)}
                            </p>
                          )}
                          <LimitResetLine resetsAt={data.sevenDay.resetsAt} />
                        </div>
                      )}

                      {/* Weekly Sonnet / special models */}
                      {data.sevenDaySonnet && labels.weeklySonnet && (
                        <div className="space-y-1.5">
                          <div className="flex items-center justify-between text-xs">
                            <span className="flex items-center gap-1.5 text-muted-foreground">
                              <Zap className="h-3 w-3" />
                              {labels.weeklySonnet.title}
                              {labels.weeklySonnet.subtitle && (
                                <span className="text-muted-foreground/60">
                                  ({labels.weeklySonnet.subtitle})
                                </span>
                              )}
                            </span>
                            <span className="font-medium">{data.sevenDaySonnet.utilization}%</span>
                          </div>
                          <div className="h-2 bg-muted rounded-full overflow-hidden">
                            <div
                              className="h-full rounded-full transition-all duration-500"
                              style={{
                                width: `${Math.min(100, data.sevenDaySonnet.utilization)}%`,
                                backgroundColor:
                                  data.sevenDaySonnet.utilization > 80
                                    ? '#ef4444'
                                    : withAlpha(color, '99'),
                              }}
                            />
                          </div>
                          {formatLimitUsage(data.sevenDaySonnet) && (
                            <p className="text-[11px] text-muted-foreground">
                              {formatLimitUsage(data.sevenDaySonnet)}
                            </p>
                          )}
                          <LimitResetLine resetsAt={data.sevenDaySonnet.resetsAt} />
                        </div>
                      )}

                      {data.additional?.map((limit) => (
                        <div key={limit.name} className="space-y-1.5">
                          <div className="flex items-center justify-between text-xs">
                            <span className="flex items-center gap-1.5 text-muted-foreground">
                              <Gauge className="h-3 w-3" />
                              {limit.name.replace(/_/g, ' ')}
                            </span>
                            <span className="font-medium">{limit.utilization}%</span>
                          </div>
                          <div className="h-2 bg-muted rounded-full overflow-hidden">
                            <div
                              className="h-full rounded-full transition-all duration-500"
                              style={{
                                width: `${Math.min(100, limit.utilization)}%`,
                                backgroundColor: limit.utilization > 80 ? '#ef4444' : color,
                              }}
                            />
                          </div>
                          {formatLimitUsage(limit) && (
                            <p className="text-[11px] text-muted-foreground">
                              {formatLimitUsage(limit)}
                            </p>
                          )}
                          <LimitResetLine resetsAt={limit.resetsAt} />
                        </div>
                      ))}
                    </div>

                    {data.localBudget && (
                      <div className="grid grid-cols-2 gap-2 border-t border-border/60 pt-3 text-xs">
                        <div>
                          <p className="text-muted-foreground">24h spend</p>
                          <p className="font-medium">
                            {formatCurrency(data.localBudget.dailySpendUsd)}
                            {data.localBudget.dailyUsd
                              ? ` / ${formatCurrency(data.localBudget.dailyUsd)}`
                              : ''}
                          </p>
                        </div>
                        <div>
                          <p className="text-muted-foreground">Weekly spend</p>
                          <p className="font-medium">
                            {formatCurrency(data.localBudget.weeklySpendUsd)}
                            {data.localBudget.weeklyUsd
                              ? ` / ${formatCurrency(data.localBudget.weeklyUsd)}`
                              : ''}
                          </p>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      <div className="analytics-metric-grid">
        <Card className="analytics-metric-card is-tokens">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Total Tokens
            </CardTitle>
            <Cpu className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold">
              {isLoading ? '...' : formatNumber(totalTokens)}
            </div>
            <p className="text-xs text-muted-foreground">
              {formatNumber(summary?.totals.inputTokens || 0)} in ·{' '}
              {formatNumber(summary?.totals.outputTokens || 0)} out
            </p>
          </CardContent>
        </Card>

        <Card className="analytics-metric-card is-spend">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              API Spend
            </CardTitle>
            <Coins className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold">
              {isLoading ? '...' : formatCurrency(totalCost)}
            </div>
            <p className="text-xs text-muted-foreground">
              API-equivalent · avg {formatCurrency(avgCost)} per request
            </p>
          </CardContent>
        </Card>

        <Card className="analytics-metric-card">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Effective Rate
            </CardTitle>
            <Coins className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold">
              {isLoading ? '...' : formatCurrency(effectiveCostPerMillion)}
            </div>
            <p className="text-xs text-muted-foreground">Per 1M total tokens</p>
          </CardContent>
        </Card>

        <Card className="analytics-metric-card">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Requests
            </CardTitle>
            <Layers className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold">
              {isLoading ? '...' : totalRequests.toLocaleString()}
            </div>
            <p className="text-xs text-muted-foreground">
              Avg {formatNumber(avgTokens)} tokens per request
            </p>
          </CardContent>
        </Card>

        <Card className="analytics-metric-card">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Cache Efficiency
            </CardTitle>
            <Database className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold">{isLoading ? '...' : `${cacheHitRate}%`}</div>
            <p className="text-xs text-muted-foreground">
              {formatNumber(summary?.totals.cacheReadTokens || 0)} cache hits
            </p>
          </CardContent>
        </Card>

        <Card className="analytics-metric-card">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Pricing Coverage
            </CardTitle>
            <Database className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold">
              {isLoading ? '...' : `${pricingCoveragePercent}%`}
            </div>
            <p className="text-xs text-muted-foreground">
              {formatNumber(unpricedTokens)} tokens unpriced
            </p>
          </CardContent>
        </Card>

        <Card className="analytics-metric-card">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Context Events
            </CardTitle>
            <Gauge className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold">
              {isLoading ? '...' : `${Math.round(latestContextPercent)}%`}
            </div>
            <p className="text-xs text-muted-foreground">
              {contextSnapshots.toLocaleString()} snapshots · {compactEvents.toLocaleString()}{' '}
              compacts
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="analytics-main-grid">
        <Card className="analytics-chart-panel">
          <CardHeader className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div>
              <CardTitle className="text-lg">Usage Over Time</CardTitle>
              <CardDescription>
                Per-model volume across every provider in the selected window.
              </CardDescription>
            </div>
            <div role="radiogroup" aria-label="Chart metric" className="flex flex-wrap gap-2">
              {CHART_METRICS.map((metric, idx) => (
                <button
                  key={metric.value}
                  type="button"
                  role="radio"
                  aria-checked={chartMetric === metric.value}
                  tabIndex={chartMetric === metric.value ? 0 : -1}
                  onClick={() => setChartMetric(metric.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
                      e.preventDefault();
                      const next = CHART_METRICS[(idx + 1) % CHART_METRICS.length];
                      if (next) setChartMetric(next.value);
                    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
                      e.preventDefault();
                      const prev =
                        CHART_METRICS[(idx - 1 + CHART_METRICS.length) % CHART_METRICS.length];
                      if (prev) setChartMetric(prev.value);
                    }
                  }}
                  className={cn(
                    'ui-pill ui-pill-subtle transition-colors',
                    chartMetric === metric.value &&
                      'bg-foreground text-background border-transparent'
                  )}
                >
                  {metric.label}
                </button>
              ))}
            </div>
          </CardHeader>
          <CardContent>
            <div className="h-[320px]">
              {timelineLoading ? (
                <div className="flex flex-col items-center justify-center h-full gap-2 text-muted-foreground">
                  <Loader2 className="h-5 w-5 animate-spin" />
                  <span className="text-sm">Loading timeline…</span>
                </div>
              ) : timelineError ? (
                <div className="flex flex-col items-center justify-center h-full gap-2 text-destructive">
                  <AlertCircle className="h-5 w-5" />
                  <span className="text-sm">Failed to load timeline</span>
                </div>
              ) : chartData.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%" minHeight={240} minWidth={0}>
                  <AreaChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                    <XAxis
                      dataKey="date"
                      tick={{ fontSize: 12 }}
                      tickFormatter={(value) => formatTimelineLabel(String(value))}
                    />
                    <YAxis
                      tick={{ fontSize: 12 }}
                      tickFormatter={(value) => formatChartValue(chartMetric, value)}
                    />
                    <Tooltip
                      content={({ active, payload, label }) => {
                        if (!active || !payload?.length) return null;
                        return (
                          <div className="bg-popover border border-border/70 rounded-lg p-3 shadow-sm">
                            <p className="font-medium mb-2">{formatTimelineLabel(String(label))}</p>
                            {payload.map((entry) => (
                              <p
                                key={entry.dataKey}
                                className="text-sm"
                                style={{ color: entry.color }}
                              >
                                {entry.name}: {formatChartValue(chartMetric, entry.value as number)}
                              </p>
                            ))}
                          </div>
                        );
                      }}
                    />
                    <Legend wrapperStyle={{ fontSize: 12, paddingTop: 8 }} iconType="circle" />
                    {chartSeries.map((series) => (
                      <Area
                        key={series.key}
                        type="monotone"
                        dataKey={series.key}
                        name={series.label}
                        stackId={
                          modelSeries.length > 0 ? '1' : chartMetric === 'tokens' ? '1' : undefined
                        }
                        stroke={series.color}
                        fill={series.color}
                        fillOpacity={series.fillOpacity}
                      />
                    ))}
                  </AreaChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex items-center justify-center h-full text-muted-foreground">
                  No data available for this period
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        <Card className="analytics-composition-panel">
          <CardHeader>
            <CardTitle className="text-lg">Token Composition</CardTitle>
            <CardDescription>Input, output, and cache volume combined.</CardDescription>
          </CardHeader>
          <CardContent>
            {tokenBreakdown.length > 0 ? (
              <div className="space-y-4">
                <div className="flex h-3 w-full overflow-hidden rounded-full bg-muted">
                  {tokenBreakdown.map((segment) => (
                    <div
                      key={segment.key}
                      style={{
                        width: `${(segment.value / totalTokens) * 100}%`,
                        backgroundColor: segment.color,
                      }}
                    />
                  ))}
                </div>
                <div className="grid gap-2">
                  {tokenBreakdown.map((segment) => (
                    <div key={segment.key} className="flex items-center justify-between text-sm">
                      <div className="flex items-center gap-2">
                        <span
                          className="h-2 w-2 rounded-full"
                          style={{ backgroundColor: segment.color }}
                        />
                        <span className="text-muted-foreground">{segment.label}</span>
                      </div>
                      <span className="font-medium">{formatNumber(segment.value)}</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-center h-[200px] text-muted-foreground">
                No data available
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="analytics-audit-panel">
        <CardHeader className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <CardTitle className="text-lg">Pricing Health</CardTitle>
            <CardDescription>
              Stored usage rows are repriced from tokens using the current API price table.
            </CardDescription>
          </div>
          <div
            className={cn(
              'ui-pill ui-pill-subtle',
              summary?.pricingAudit?.missingPricingModels.length
                ? 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300'
                : 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
            )}
          >
            {pricingCoveragePercent}% priced
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-3">
            <div className="rounded-lg border border-border/60 bg-muted/30 p-3">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Stored API</p>
              <p className="mt-1 text-xl font-semibold">{formatCurrency(totalCost)}</p>
              <p className="text-xs text-muted-foreground">usage_history after reprice</p>
            </div>
            <div className="rounded-lg border border-border/60 bg-muted/30 p-3">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Recalculated</p>
              <p className="mt-1 text-xl font-semibold">{formatCurrency(apiEquivalentCost)}</p>
              <p className="text-xs text-muted-foreground">current rate-card check</p>
            </div>
            <div className="rounded-lg border border-border/60 bg-muted/30 p-3">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Delta</p>
              <p
                className={cn(
                  'mt-1 text-xl font-semibold',
                  Math.abs(costDelta) > 0.01
                    ? 'text-amber-600 dark:text-amber-400'
                    : 'text-muted-foreground'
                )}
              >
                {formatSignedCurrency(costDelta)}
              </p>
              <p className="text-xs text-muted-foreground">
                should stay near zero after the DB migration runs
              </p>
            </div>
          </div>

          {summary?.pricingAudit?.missingPricingModels.length ? (
            <div className="mt-4 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3">
              <div className="flex items-start gap-2">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
                <div className="space-y-2">
                  <p className="text-sm font-medium text-amber-700 dark:text-amber-300">
                    Missing model prices
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {summary.pricingAudit.missingPricingModels.slice(0, 8).map((model) => (
                      <span key={model.model} className="ui-pill ui-pill-subtle bg-background/70">
                        <span className="max-w-[180px] truncate">{model.model}</span>
                        <span className="text-muted-foreground">
                          {formatNumber(model.tokens)} tokens
                        </span>
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="mt-4 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-700 dark:text-emerald-300">
              Every model in this period matched a known API price.
            </div>
          )}
        </CardContent>
      </Card>

      <div className="analytics-lower-grid">
        <Card className="analytics-provider-panel">
          <CardHeader>
            <CardTitle className="text-lg">Provider Mix</CardTitle>
            <CardDescription>API-equivalent spend and volume by provider.</CardDescription>
          </CardHeader>
          <CardContent>
            {providerSummary.length > 0 ? (
              <div className="space-y-5">
                {providerSummary.map((provider) => {
                  const percent = totalCost > 0 ? (provider.cost / totalCost) * 100 : 0;
                  const color = getProviderColor(provider.provider);
                  return (
                    <div key={provider.provider} className="space-y-3">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span
                            className="h-2.5 w-2.5 rounded-full"
                            style={{ backgroundColor: color }}
                          />
                          <span className="text-sm font-medium">{provider.provider}</span>
                          <span
                            className="ui-pill ui-pill-subtle text-foreground"
                            style={{
                              borderColor: withAlpha(color, '66'),
                              backgroundColor: withAlpha(color, '14'),
                            }}
                          >
                            {percent.toFixed(1)}%
                          </span>
                        </div>
                        <span className="text-sm text-muted-foreground">
                          {formatCurrency(provider.cost)}
                        </span>
                      </div>
                      <div className="h-2 bg-muted rounded-full overflow-hidden">
                        <div
                          className="h-full rounded-full"
                          style={{ width: `${percent}%`, backgroundColor: color }}
                        />
                      </div>
                      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                        <span>{formatNumber(provider.tokens)} tokens</span>
                        <span>·</span>
                        <span>{provider.requests} requests</span>
                        <span>·</span>
                        <span>API {formatCurrency(provider.theoreticalCost)}</span>
                        {provider.unpricedTokens > 0 && (
                          <>
                            <span>·</span>
                            <span className="text-amber-600 dark:text-amber-400">
                              {formatNumber(provider.unpricedTokens)} unpriced
                            </span>
                          </>
                        )}
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {provider.models.map((model) => (
                          <span
                            key={model.model}
                            className="ui-pill ui-pill-subtle"
                            style={{
                              borderColor: withAlpha(color, '40'),
                              backgroundColor: withAlpha(color, '0f'),
                            }}
                          >
                            <span className="truncate max-w-[140px]">{model.model}</span>
                            {model.pricingKnown === false && (
                              <span className="text-amber-600 dark:text-amber-400">no price</span>
                            )}
                          </span>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="flex items-center justify-center h-[200px] text-muted-foreground">
                No provider data available
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="analytics-model-panel">
          <CardHeader>
            <CardTitle className="text-lg">Top Models</CardTitle>
            <CardDescription>Highest API-equivalent spend by model.</CardDescription>
          </CardHeader>
          <CardContent>
            {summary?.byModel && summary.byModel.length > 0 ? (
              <div className="space-y-3">
                {summary.byModel.slice(0, 8).map((model, index) => {
                  const provider = getProviderLabelForModel(model.model);
                  const color = getProviderColor(provider);
                  return (
                    <div
                      key={model.model || `model-${index}`}
                      className="flex items-center justify-between rounded-lg border border-border/60 bg-muted/40 px-3 py-2"
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">{model.model || 'Unknown'}</p>
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          <span
                            className="ui-pill ui-pill-subtle text-foreground"
                            style={{
                              borderColor: withAlpha(color, '66'),
                              backgroundColor: withAlpha(color, '14'),
                            }}
                          >
                            <span
                              className="h-2 w-2 rounded-full"
                              style={{ backgroundColor: color }}
                            />
                            {provider}
                          </span>
                          <span>{formatNumber(model.total_tokens)} tokens</span>
                          {model.pricing ? (
                            <span>
                              {formatRate(model.pricing.input)} in /{' '}
                              {formatRate(model.pricing.output)} out
                            </span>
                          ) : (
                            <span className="text-amber-600 dark:text-amber-400">
                              missing price
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-sm font-medium">{formatCurrency(model.cost)}</p>
                        <p className="text-xs text-muted-foreground">
                          API {formatCurrency(model.theoretical_cost)} · {model.requests} req
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="flex items-center justify-center h-[200px] text-muted-foreground">
                No model data available
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="analytics-sessions-panel">
        <CardHeader className="flex items-center justify-between gap-3 md:flex-row">
          <div>
            <CardTitle className="text-lg">Top Sessions</CardTitle>
            <CardDescription>Sessions with the most combined activity.</CardDescription>
          </div>
          <div className="ui-pill ui-pill-subtle">
            <Sparkles className="h-3.5 w-3.5" />
            <span className="ui-pill-value">Unified ledger</span>
          </div>
        </CardHeader>
        <CardContent>
          {summary?.bySession && summary.bySession.length > 0 ? (
            <>
              <div className="grid gap-3 md:grid-cols-2">
                {summary.bySession.slice(0, topSessionsLimit).map((session, index) => (
                  <Link
                    key={session.session_id}
                    to={`/session/${session.session_id}`}
                    className="flex items-center justify-between rounded-lg border border-border/60 bg-muted/40 px-3 py-2 transition-colors hover:bg-muted/70 hover:border-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="flex items-center justify-center w-7 h-7 rounded-full bg-background text-xs font-medium border border-border/60">
                        {index + 1}
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">
                          {session.session_name || 'Unnamed Session'}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {formatNumber(session.total_tokens)} tokens · {session.requests} req
                        </p>
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-sm font-medium">{formatCurrency(session.cost)}</p>
                      <p className="text-xs text-muted-foreground">{session.requests} req</p>
                    </div>
                  </Link>
                ))}
              </div>
              {summary.bySession.length > topSessionsLimit && (
                <div className="flex justify-center pt-4">
                  <button
                    type="button"
                    onClick={() => setTopSessionsLimit((n) => n + TOP_SESSIONS_PAGE_SIZE)}
                    className="ui-pill ui-pill-subtle transition-colors hover:bg-muted"
                  >
                    Show more ({summary.bySession.length - topSessionsLimit} left)
                  </button>
                </div>
              )}
            </>
          ) : (
            <div className="flex items-center justify-center h-[200px] text-muted-foreground">
              No session data available
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
