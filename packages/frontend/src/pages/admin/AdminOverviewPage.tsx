import { useQuery } from '@tanstack/react-query';
import { Users, Shield, UserX, MessageSquare, Activity, FileText } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { api } from '@/services/api';

interface AdminStats {
  userCount: number;
  adminCount: number;
  suspendedCount: number;
  sessionCount: number;
  runningSessionCount: number;
  auditCount: number;
}

const cards = [
  { key: 'userCount', label: 'Total users', icon: Users, tone: 'text-sky-500' },
  { key: 'adminCount', label: 'Admins', icon: Shield, tone: 'text-amber-500' },
  { key: 'suspendedCount', label: 'Suspended', icon: UserX, tone: 'text-rose-500' },
  { key: 'sessionCount', label: 'Sessions', icon: MessageSquare, tone: 'text-violet-500' },
  { key: 'runningSessionCount', label: 'Running now', icon: Activity, tone: 'text-emerald-500' },
  { key: 'auditCount', label: 'Audit entries', icon: FileText, tone: 'text-slate-400' },
] as const;

export function AdminOverviewPage() {
  const { data, isLoading, error } = useQuery<AdminStats>({
    queryKey: ['admin', 'stats'],
    queryFn: async () => {
      const response = await api.get<{ success: boolean; data: AdminStats }>('/api/admin/stats');
      return response.data.data;
    },
    refetchInterval: 15_000,
  });

  if (error) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-sm text-muted-foreground">
          Failed to load stats: {(error as Error).message}
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {cards.map((card) => {
        const Icon = card.icon;
        const value = data?.[card.key];
        return (
          <Card key={card.key}>
            <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {card.label}
              </CardTitle>
              <Icon className={`h-4 w-4 ${card.tone}`} />
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-semibold tracking-tight tabular-nums">
                {isLoading ? <span className="text-muted-foreground/50">—</span> : (value ?? 0)}
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
