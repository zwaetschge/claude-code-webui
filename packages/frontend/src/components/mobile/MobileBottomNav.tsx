import { MessageSquare, FolderTree, GitBranch, Code2, ListTodo } from 'lucide-react';
import { cn } from '@/lib/utils';

export type MobileView = 'chat' | 'files' | 'git' | 'editor' | 'todos';

interface MobileBottomNavProps {
  activeView: MobileView;
  onViewChange: (view: MobileView) => void;
  hasOpenFiles?: boolean;
  hasTodos?: boolean;
  changesCount?: number;
  todosCount?: number;
}

export function MobileBottomNav({
  activeView,
  onViewChange,
  hasOpenFiles = false,
  hasTodos = false,
  changesCount = 0,
  todosCount = 0,
}: MobileBottomNavProps) {
  const navItems: { id: MobileView; icon: React.ElementType; label: string; badge?: number; show?: boolean }[] = [
    { id: 'chat', icon: MessageSquare, label: 'Chat' },
    { id: 'files', icon: FolderTree, label: 'Files' },
    { id: 'git', icon: GitBranch, label: 'Git', badge: changesCount > 0 ? changesCount : undefined },
    { id: 'editor', icon: Code2, label: 'Editor', show: hasOpenFiles },
    { id: 'todos', icon: ListTodo, label: 'Todos', badge: todosCount > 0 ? todosCount : undefined, show: hasTodos },
  ];

  const visibleItems = navItems.filter((item) => item.show !== false);

  return (
    <nav className="md:hidden fixed bottom-0 left-0 right-0 z-50 bg-card border-t safe-area-pb">
      <div className="flex items-center justify-around h-14">
        {visibleItems.map((item) => {
          const Icon = item.icon;
          const isActive = activeView === item.id;

          return (
            <button
              key={item.id}
              onClick={() => onViewChange(item.id)}
              className={cn(
                'flex flex-col items-center justify-center flex-1 h-full gap-0.5 transition-colors relative',
                isActive ? 'text-primary' : 'text-muted-foreground'
              )}
            >
              <div className="relative">
                <Icon className="h-5 w-5" />
                {item.badge && item.badge > 0 && (
                  <span className="absolute -top-1 -right-2 min-w-[16px] h-4 px-1 text-[10px] font-medium rounded-full bg-amber-500 text-white flex items-center justify-center">
                    {item.badge > 99 ? '99+' : item.badge}
                  </span>
                )}
              </div>
              <span className="text-[10px] font-medium">{item.label}</span>
              {isActive && (
                <span className="absolute bottom-0 left-1/2 -translate-x-1/2 w-8 h-0.5 bg-primary rounded-full" />
              )}
            </button>
          );
        })}
      </div>
    </nav>
  );
}
