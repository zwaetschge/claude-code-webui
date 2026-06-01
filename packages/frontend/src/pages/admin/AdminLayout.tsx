import { NavLink, Outlet } from 'react-router-dom';
import { Shield, Users, FileText, LayoutDashboard } from 'lucide-react';
import { cn } from '@/lib/utils';

const tabs = [
  { to: '/admin', label: 'Overview', icon: LayoutDashboard, end: true },
  { to: '/admin/users', label: 'Users', icon: Users, end: false },
  { to: '/admin/audit-log', label: 'Audit Log', icon: FileText, end: false },
];

export function AdminLayout() {
  return (
    <div className="flex h-full flex-col">
      <div className="border-b bg-card/30 backdrop-blur-sm">
        <div className="px-6 pt-5 pb-3 flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Shield className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-lg font-semibold tracking-tight">Admin Console</h1>
            <p className="text-xs text-muted-foreground">
              Manage users, review activity, and monitor the system.
            </p>
          </div>
        </div>
        <nav className="flex gap-1 px-4 pb-1">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            return (
              <NavLink
                key={tab.to}
                to={tab.to}
                end={tab.end}
                className={({ isActive }) =>
                  cn(
                    'relative inline-flex items-center gap-2 rounded-t-lg border-b-2 px-3 py-2 text-sm font-medium transition-colors',
                    isActive
                      ? 'border-primary text-foreground'
                      : 'border-transparent text-muted-foreground hover:text-foreground'
                  )
                }
              >
                <Icon className="h-4 w-4" />
                {tab.label}
              </NavLink>
            );
          })}
        </nav>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        <Outlet />
      </div>
    </div>
  );
}
