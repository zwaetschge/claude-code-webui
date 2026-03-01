import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
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
} from 'lucide-react';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { api } from '@/services/api';
import { cn } from '@/lib/utils';
import { CLI_PROVIDER_LABEL, CLI_PROVIDER_LIMIT_LABELS, type CLIProvider } from '@/lib/providers';
import { ProviderLogo } from '@/components/branding/ProviderLogo';

interface ApiResponse<T> {
  success: boolean;
  data: T;
}

interface AnalyticsSummary {
  period: string;
  totals: {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheCreationTokens: number;
    totalTokens: number;
    totalCost: number;
    totalRequests: number;
  };
  byModel: Array<{
    model: string;
    input_tokens: number;
    output_tokens: number;
    total_tokens: number;
    cost: number;
    requests: number;
  }>;
  bySession: Array<{
    session_id: string;
    session_name: string;
    total_tokens: number;
    cost: number;
    requests: number;
  }>;
}

interface TimelineData {
  date: string;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  total_tokens: number;
  cost: number;
  requests: number;
  providers?: Record<string, { tokens: number; cost: number; requests: number }>;
}

interface ProviderStats {
  provider: string;
  cost: number;
  tokens: number;
  requests: number;
  models: Array<{
    model: string;
    cost: number;
    tokens: number;
    requests: number;
  }>;
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
  error?: { code: string; message: string };
}

const USAGE_PROVIDERS: CLIProvider[] = ['claude', 'codex', 'glm'];

const USAGE_PROVIDER_COLORS: Record<CLIProvider, string> = {
  claude: '#f97316',
  codex: '#22c55e',
  gemini: '#3b82f6',
  glm: '#06b6d4',
  kimi: '#6b7280',
  multi: '#a855f7',
};

const PERIODS = [
  { value: '24h', label: '24h' },
  { value: '7d', label: '7 Days' },
  { value: '30d', label: '30 Days' },
  { value: 'all', label: 'All Time' },
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
  Claude: '#f97316',
  Codex: '#22c55e',
  Gemini: '#3b82f6',
  'Z.AI': '#06b6d4',
  Other: PROVIDER_FALLBACK_COLOR,
};

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

function getProviderLabel(model?: string): string {
  const value = (model || '').toLowerCase();
  if (!value) return 'Other';
  if (value.includes('gpt') || value.includes('codex')) return 'Codex';
  if (value.includes('claude')) return 'Claude';
  if (value.includes('gemini')) return 'Gemini';
  if (value.includes('glm') || value.includes('zai')) return 'Z.AI';
  return 'Other';
}

function getProviderKey(provider: string): string {
  const normalized = provider.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  return `provider_${normalized || 'other'}`;
}

function formatChartValue(metric: ChartMetric, value: number): string {
  if (metric === 'cost') return formatCurrency(value);
  if (metric === 'requests') return value.toLocaleString();
  return formatNumber(value);
}

export function AnalyticsPage() {
  const [period, setPeriod] = useState('7d');
  const [chartMetric, setChartMetric] = useState<ChartMetric>('tokens');

  const { data: summary, isLoading: summaryLoading } = useQuery({
    queryKey: ['analytics-summary', period],
    queryFn: async () => {
      const response = await api.get<ApiResponse<AnalyticsSummary>>(`/api/analytics/summary?period=${period}`);
      return response.data.data;
    },
  });

  const { data: timeline, isLoading: timelineLoading } = useQuery({
    queryKey: ['analytics-timeline', period],
    queryFn: async () => {
      const response = await api.get<ApiResponse<TimelineData[]>>(`/api/analytics/timeline?period=${period}`);
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
      retry: 1,
    });
  });

  const usageLimitsData = usageLimitsQueries
    .filter((q) => q.data?.success && q.data?.supported && q.data?.data)
    .map((q) => ({
      provider: q.data!.cliProvider,
      data: q.data!.data!,
    }));

  const usageLimitsLoading = usageLimitsQueries.some((q) => q.isLoading);

  const isLoading = summaryLoading || timelineLoading;
  const totalTokens = summary?.totals.totalTokens || 0;
  const totalCost = summary?.totals.totalCost || 0;
  const totalRequests = summary?.totals.totalRequests || 0;
  const avgCost = totalRequests > 0 ? totalCost / totalRequests : 0;
  const avgTokens = totalRequests > 0 ? totalTokens / totalRequests : 0;
  const cacheHitRate = summary && summary.totals.totalTokens > 0
    ? Math.round((summary.totals.cacheReadTokens / summary.totals.totalTokens) * 100)
    : 0;

  const tokenBreakdown = useMemo(() => {
    if (!summary) return [];
    return [
      { key: 'input', label: 'Input', value: summary.totals.inputTokens, color: TOKEN_COLORS.input },
      { key: 'output', label: 'Output', value: summary.totals.outputTokens, color: TOKEN_COLORS.output },
      { key: 'cacheRead', label: 'Cache Read', value: summary.totals.cacheReadTokens, color: TOKEN_COLORS.cacheRead },
      { key: 'cacheCreate', label: 'Cache Create', value: summary.totals.cacheCreationTokens, color: TOKEN_COLORS.cacheCreate },
    ].filter(item => item.value > 0);
  }, [summary]);

  const providerSummary = useMemo<ProviderStats[]>(() => {
    if (!summary?.byModel?.length) return [];
    const map = new Map<string, ProviderStats>();
    summary.byModel.forEach((model) => {
      const provider = getProviderLabel(model.model);
      const current = map.get(provider) || {
        provider,
        cost: 0,
        tokens: 0,
        requests: 0,
        models: [],
      };
      current.cost += model.cost;
      current.tokens += model.total_tokens;
      current.requests += model.requests;
      current.models.push({
        model: model.model || 'Unknown',
        cost: model.cost,
        tokens: model.total_tokens,
        requests: model.requests,
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

  const providerSeries = useMemo(() => {
    if (!providerSummary.length) return [];
    return providerSummary.map((provider) => ({
      key: getProviderKey(provider.provider),
      label: provider.provider,
      color: getProviderColor(provider.provider),
      fillOpacity: 0.32,
    }));
  }, [providerSummary]);

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

  const chartSeries = providerSeries.length > 0 ? providerSeries : fallbackSeries;

  const chartData = useMemo(() => {
    if (!timeline || timeline.length === 0) return [];
    if (providerSeries.length === 0) {
      return timeline;
    }
    return timeline.map((entry) => {
      const providers = entry.providers || {};
      const dataPoint: Record<string, number | string> = { date: entry.date };
      providerSeries.forEach((series) => {
        const stats = providers[series.label];
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
  }, [timeline, providerSeries, chartMetric]);

  return (
    <div className="container mx-auto py-6 px-4 max-w-7xl space-y-8">
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-[11px] uppercase tracking-widest text-muted-foreground">
            <BarChart3 className="h-4 w-4" />
            Unified Analytics
          </div>
          <h1 className="text-2xl md:text-3xl font-semibold tracking-tight">
            All providers. One ledger.
          </h1>
          <p className="text-sm text-muted-foreground max-w-2xl">
            Aggregated usage across every connected service, rolled into a single spend and volume view.
          </p>
          <div className="flex flex-wrap gap-2">
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
        </div>
        <div className="flex flex-wrap gap-2">
          {PERIODS.map((p) => (
            <button
              key={p.value}
              type="button"
              onClick={() => setPeriod(p.value)}
              className={cn(
                'ui-pill ui-pill-subtle transition-colors',
                period === p.value && 'bg-foreground text-background border-transparent'
              )}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* Provider Usage Limits */}
      {usageLimitsData.length > 0 && (
        <Card>
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
            <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
              {usageLimitsData.map(({ provider, data }) => {
                const color = USAGE_PROVIDER_COLORS[provider] || PROVIDER_FALLBACK_COLOR;
                const labels = CLI_PROVIDER_LIMIT_LABELS[provider];
                const providerName = CLI_PROVIDER_LABEL[provider];

                return (
                  <div key={provider} className="space-y-4 rounded-xl border border-border/60 bg-muted/20 p-4">
                    <div className="flex items-center gap-3">
                      <ProviderLogo provider={provider === 'glm' ? 'zai' : provider} className="h-6 w-6" />
                      <div>
                        <h3 className="text-sm font-semibold">{providerName}</h3>
                        <p className="text-xs text-muted-foreground">Rate limits</p>
                      </div>
                    </div>

                    <div className="space-y-3">
                      {/* Session / 5h limit */}
                      {data.fiveHour && (
                        <div className="space-y-1.5">
                          <div className="flex items-center justify-between text-xs">
                            <span className="flex items-center gap-1.5 text-muted-foreground">
                              <Clock className="h-3 w-3" />
                              {labels.session.title}
                              {labels.session.subtitle && (
                                <span className="text-muted-foreground/60">({labels.session.subtitle})</span>
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
                                <span className="text-muted-foreground/60">({labels.weeklyAll.subtitle})</span>
                              )}
                            </span>
                            <span className="font-medium">{data.sevenDay.utilization}%</span>
                          </div>
                          <div className="h-2 bg-muted rounded-full overflow-hidden">
                            <div
                              className="h-full rounded-full transition-all duration-500"
                              style={{
                                width: `${Math.min(100, data.sevenDay.utilization)}%`,
                                backgroundColor: data.sevenDay.utilization > 80 ? '#ef4444' : withAlpha(color, 'cc'),
                              }}
                            />
                          </div>
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
                                <span className="text-muted-foreground/60">({labels.weeklySonnet.subtitle})</span>
                              )}
                            </span>
                            <span className="font-medium">{data.sevenDaySonnet.utilization}%</span>
                          </div>
                          <div className="h-2 bg-muted rounded-full overflow-hidden">
                            <div
                              className="h-full rounded-full transition-all duration-500"
                              style={{
                                width: `${Math.min(100, data.sevenDaySonnet.utilization)}%`,
                                backgroundColor: data.sevenDaySonnet.utilization > 80 ? '#ef4444' : withAlpha(color, '99'),
                              }}
                            />
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Total Tokens</CardTitle>
            <Cpu className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold">
              {isLoading ? '...' : formatNumber(totalTokens)}
            </div>
            <p className="text-xs text-muted-foreground">
              {formatNumber(summary?.totals.inputTokens || 0)} in · {formatNumber(summary?.totals.outputTokens || 0)} out
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Total Cost</CardTitle>
            <Coins className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold">
              {isLoading ? '...' : formatCurrency(totalCost)}
            </div>
            <p className="text-xs text-muted-foreground">
              Avg {formatCurrency(avgCost)} per request
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Requests</CardTitle>
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

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Cache Efficiency</CardTitle>
            <Database className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold">
              {isLoading ? '...' : `${cacheHitRate}%`}
            </div>
            <p className="text-xs text-muted-foreground">
              {formatNumber(summary?.totals.cacheReadTokens || 0)} cache hits
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-[2fr,1fr]">
        <Card>
          <CardHeader className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div>
              <CardTitle className="text-lg">Usage Over Time</CardTitle>
              <CardDescription>Unified volume across every provider in the selected window.</CardDescription>
            </div>
            <div className="flex flex-wrap gap-2">
              {CHART_METRICS.map((metric) => (
                <button
                  key={metric.value}
                  type="button"
                  onClick={() => setChartMetric(metric.value)}
                  className={cn(
                    'ui-pill ui-pill-subtle transition-colors',
                    chartMetric === metric.value && 'bg-foreground text-background border-transparent'
                  )}
                >
                  {metric.label}
                </button>
              ))}
            </div>
          </CardHeader>
          <CardContent>
            <div className="h-[320px]">
              {chartData.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%" minHeight={240} minWidth={0}>
                  <AreaChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                    <XAxis
                      dataKey="date"
                      tick={{ fontSize: 12 }}
                      tickFormatter={(value) => {
                        const date = new Date(value);
                        return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
                      }}
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
                            <p className="font-medium mb-2">{label}</p>
                            {payload.map((entry) => (
                              <p key={entry.dataKey} className="text-sm" style={{ color: entry.color }}>
                                {entry.name}: {formatChartValue(chartMetric, entry.value as number)}
                              </p>
                            ))}
                          </div>
                        );
                      }}
                    />
                    {chartSeries.map((series) => (
                      <Area
                        key={series.key}
                        type="monotone"
                        dataKey={series.key}
                        name={series.label}
                        stackId={providerSeries.length > 0 ? '1' : chartMetric === 'tokens' ? '1' : undefined}
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

        <Card>
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
                        <span className="h-2 w-2 rounded-full" style={{ backgroundColor: segment.color }} />
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

      <div className="grid gap-6 lg:grid-cols-[1.2fr,1fr]">
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Provider Mix</CardTitle>
            <CardDescription>Spend and volume shared across connected services.</CardDescription>
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
                          <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: color }} />
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

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Top Models</CardTitle>
            <CardDescription>Most active models regardless of provider.</CardDescription>
          </CardHeader>
          <CardContent>
            {summary?.byModel && summary.byModel.length > 0 ? (
              <div className="space-y-3">
                {summary.byModel.slice(0, 8).map((model, index) => {
                  const provider = getProviderLabel(model.model);
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
                            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: color }} />
                            {provider}
                          </span>
                          <span>{formatNumber(model.total_tokens)} tokens</span>
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-sm font-medium">{formatCurrency(model.cost)}</p>
                        <p className="text-xs text-muted-foreground">{model.requests} req</p>
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

      <Card>
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
            <div className="grid gap-3 md:grid-cols-2">
              {summary.bySession.slice(0, 10).map((session, index) => (
                <div
                  key={session.session_id}
                  className="flex items-center justify-between rounded-lg border border-border/60 bg-muted/40 px-3 py-2"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="flex items-center justify-center w-7 h-7 rounded-full bg-background text-xs font-medium border border-border/60">
                      {index + 1}
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{session.session_name || 'Unnamed Session'}</p>
                      <p className="text-xs text-muted-foreground">
                        {formatNumber(session.total_tokens)} tokens · {session.requests} req
                      </p>
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-sm font-medium">{formatCurrency(session.cost)}</p>
                    <p className="text-xs text-muted-foreground">{session.requests} req</p>
                  </div>
                </div>
              ))}
            </div>
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
