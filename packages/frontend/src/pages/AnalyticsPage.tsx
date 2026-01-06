import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  BarChart3,
  TrendingUp,
  Coins,
  Cpu,
  Database,
} from 'lucide-react';
import {
  AreaChart,
  Area,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { api } from '@/services/api';
import { cn } from '@/lib/utils';

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
}

const PERIODS = [
  { value: '24h', label: '24h' },
  { value: '7d', label: '7 Days' },
  { value: '30d', label: '30 Days' },
  { value: 'all', label: 'All Time' },
];

const COLORS = ['#8b5cf6', '#06b6d4', '#10b981', '#f59e0b', '#ef4444', '#ec4899'];

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

export function AnalyticsPage() {
  const [period, setPeriod] = useState('7d');

  // Fetch analytics summary
  const { data: summary, isLoading: summaryLoading } = useQuery({
    queryKey: ['analytics-summary', period],
    queryFn: async () => {
      const response = await api.get<ApiResponse<AnalyticsSummary>>(`/api/analytics/summary?period=${period}`);
      return response.data.data;
    },
  });

  // Fetch timeline data
  const { data: timeline, isLoading: timelineLoading } = useQuery({
    queryKey: ['analytics-timeline', period],
    queryFn: async () => {
      const response = await api.get<ApiResponse<TimelineData[]>>(`/api/analytics/timeline?period=${period}`);
      return response.data.data;
    },
  });

  const isLoading = summaryLoading || timelineLoading;

  // Calculate token breakdown for pie chart
  const tokenBreakdown = summary ? [
    { name: 'Input', value: summary.totals.inputTokens, color: '#8b5cf6' },
    { name: 'Output', value: summary.totals.outputTokens, color: '#06b6d4' },
    { name: 'Cache Read', value: summary.totals.cacheReadTokens, color: '#10b981' },
    { name: 'Cache Create', value: summary.totals.cacheCreationTokens, color: '#f59e0b' },
  ].filter(item => item.value > 0) : [];

  return (
    <div className="container mx-auto py-6 px-4 max-w-7xl">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <BarChart3 className="h-6 w-6 text-violet-500" />
            Analytics
          </h1>
          <p className="text-muted-foreground mt-1">
            Track your token usage, costs, and session activity
          </p>
        </div>

        {/* Period selector */}
        <div className="flex gap-1 bg-muted p-1 rounded-lg">
          {PERIODS.map((p) => (
            <Button
              key={p.value}
              variant={period === p.value ? 'default' : 'ghost'}
              size="sm"
              onClick={() => setPeriod(p.value)}
              className={cn(
                'h-8 px-3',
                period === p.value && 'bg-violet-600 hover:bg-violet-700'
              )}
            >
              {p.label}
            </Button>
          ))}
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4 mb-6">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Total Tokens</CardTitle>
            <Cpu className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {isLoading ? '...' : formatNumber(summary?.totals.totalTokens || 0)}
            </div>
            <p className="text-xs text-muted-foreground">
              {formatNumber(summary?.totals.inputTokens || 0)} in / {formatNumber(summary?.totals.outputTokens || 0)} out
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Total Cost</CardTitle>
            <Coins className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">
              {isLoading ? '...' : formatCurrency(summary?.totals.totalCost || 0)}
            </div>
            <p className="text-xs text-muted-foreground">
              Across {summary?.totals.totalRequests || 0} requests
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Cache Efficiency</CardTitle>
            <Database className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-cyan-600">
              {isLoading ? '...' : (
                summary && summary.totals.totalTokens > 0
                  ? Math.round((summary.totals.cacheReadTokens / summary.totals.totalTokens) * 100)
                  : 0
              )}%
            </div>
            <p className="text-xs text-muted-foreground">
              {formatNumber(summary?.totals.cacheReadTokens || 0)} cache hits
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Avg Cost/Request</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {isLoading ? '...' : (
                summary && summary.totals.totalRequests > 0
                  ? formatCurrency(summary.totals.totalCost / summary.totals.totalRequests)
                  : '$0.00'
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              Per API request
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Charts Row */}
      <div className="grid gap-6 md:grid-cols-2 mb-6">
        {/* Usage Over Time Chart */}
        <Card className="col-span-1 md:col-span-2 lg:col-span-1">
          <CardHeader>
            <CardTitle className="text-lg">Usage Over Time</CardTitle>
            <CardDescription>Token consumption trend</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-[300px]">
              {timeline && timeline.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={timeline}>
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
                      tickFormatter={(value) => formatNumber(value)}
                    />
                    <Tooltip
                      content={({ active, payload, label }) => {
                        if (!active || !payload?.length) return null;
                        return (
                          <div className="bg-popover border rounded-lg p-3 shadow-lg">
                            <p className="font-medium mb-2">{label}</p>
                            {payload.map((entry, index) => (
                              <p key={index} className="text-sm" style={{ color: entry.color }}>
                                {entry.name}: {formatNumber(entry.value as number)}
                              </p>
                            ))}
                          </div>
                        );
                      }}
                    />
                    <Legend />
                    <Area
                      type="monotone"
                      dataKey="input_tokens"
                      name="Input"
                      stackId="1"
                      stroke="#8b5cf6"
                      fill="#8b5cf6"
                      fillOpacity={0.6}
                    />
                    <Area
                      type="monotone"
                      dataKey="output_tokens"
                      name="Output"
                      stackId="1"
                      stroke="#06b6d4"
                      fill="#06b6d4"
                      fillOpacity={0.6}
                    />
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

        {/* Token Breakdown Pie Chart */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Token Breakdown</CardTitle>
            <CardDescription>Distribution by type</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-[300px]">
              {tokenBreakdown.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={tokenBreakdown}
                      cx="50%"
                      cy="50%"
                      innerRadius={60}
                      outerRadius={100}
                      paddingAngle={2}
                      dataKey="value"
                    >
                      {tokenBreakdown.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip
                      content={({ active, payload }) => {
                        if (!active || !payload?.length) return null;
                        const data = payload[0].payload;
                        return (
                          <div className="bg-popover border rounded-lg p-3 shadow-lg">
                            <p className="font-medium">{data.name}</p>
                            <p className="text-sm text-muted-foreground">
                              {formatNumber(data.value)} tokens
                            </p>
                          </div>
                        );
                      }}
                    />
                    <Legend
                      formatter={(value) => (
                        <span className="text-sm">{value}</span>
                      )}
                    />
                  </PieChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex items-center justify-center h-full text-muted-foreground">
                  No data available
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Model & Session Breakdown */}
      <div className="grid gap-6 md:grid-cols-2">
        {/* By Model */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Usage by Model</CardTitle>
            <CardDescription>Cost distribution across models</CardDescription>
          </CardHeader>
          <CardContent>
            {summary?.byModel && summary.byModel.length > 0 ? (
              <div className="space-y-4">
                {summary.byModel.map((model, index) => {
                  const percentage = summary.totals.totalCost > 0
                    ? (model.cost / summary.totals.totalCost) * 100
                    : 0;
                  return (
                    <div key={model.model || 'unknown'} className="space-y-2">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <div
                            className="w-3 h-3 rounded-full"
                            style={{ backgroundColor: COLORS[index % COLORS.length] }}
                          />
                          <span className="text-sm font-medium truncate max-w-[200px]">
                            {model.model || 'Unknown'}
                          </span>
                        </div>
                        <div className="text-sm text-muted-foreground">
                          {formatCurrency(model.cost)}
                        </div>
                      </div>
                      <div className="h-2 bg-muted rounded-full overflow-hidden">
                        <div
                          className="h-full rounded-full transition-all"
                          style={{
                            width: `${percentage}%`,
                            backgroundColor: COLORS[index % COLORS.length],
                          }}
                        />
                      </div>
                      <div className="flex justify-between text-xs text-muted-foreground">
                        <span>{formatNumber(model.total_tokens)} tokens</span>
                        <span>{model.requests} requests</span>
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

        {/* By Session */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Top Sessions</CardTitle>
            <CardDescription>Most active sessions by cost</CardDescription>
          </CardHeader>
          <CardContent>
            {summary?.bySession && summary.bySession.length > 0 ? (
              <div className="space-y-3">
                {summary.bySession.slice(0, 8).map((session, index) => (
                  <div
                    key={session.session_id}
                    className="flex items-center justify-between p-2 rounded-lg hover:bg-muted/50 transition-colors"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="flex items-center justify-center w-6 h-6 rounded-full bg-muted text-xs font-medium">
                        {index + 1}
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">
                          {session.session_name || 'Unnamed Session'}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {formatNumber(session.total_tokens)} tokens
                        </p>
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-sm font-medium text-green-600">
                        {formatCurrency(session.cost)}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {session.requests} req
                      </p>
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
    </div>
  );
}
