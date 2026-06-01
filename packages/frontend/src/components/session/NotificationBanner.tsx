import { useState, useEffect } from 'react';
import { Bell, BellOff, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { notificationService } from '@/services/notifications';
import { cn } from '@/lib/utils';
import { useProviderStore } from '@/stores/providerStore';
import { UI_PROVIDER_META } from '@/lib/providers';

export function NotificationBanner() {
  const [showBanner, setShowBanner] = useState(false);
  const [permission, setPermission] = useState<NotificationPermission>('default');
  const [enabled, setEnabled] = useState(true);
  const { uiProvider } = useProviderStore();
  const providerLabel = UI_PROVIDER_META[uiProvider].label;

  useEffect(() => {
    // Check if notifications are supported and what the current permission is
    if ('Notification' in window) {
      setPermission(Notification.permission);
      setEnabled(notificationService.isEnabled());

      // Show banner if permission is default (not yet asked) and not dismissed
      const dismissed = localStorage.getItem('notification_banner_dismissed');
      if (Notification.permission === 'default' && !dismissed) {
        setShowBanner(true);
      }
    }
  }, []);

  const handleEnable = async () => {
    const granted = await notificationService.requestPermission();
    if (granted) {
      setPermission('granted');
      notificationService.setEnabled(true);
      setEnabled(true);
    }
    setShowBanner(false);
  };

  const handleDismiss = () => {
    localStorage.setItem('notification_banner_dismissed', 'true');
    setShowBanner(false);
  };

  const handleToggle = () => {
    const newEnabled = !enabled;
    notificationService.setEnabled(newEnabled);
    setEnabled(newEnabled);
  };

  // If notifications are not supported, don't show anything
  if (!('Notification' in window)) {
    return null;
  }

  // If permission is already decided (granted or denied), show toggle button only
  if (permission !== 'default' && !showBanner) {
    return (
      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8 shrink-0"
        onClick={handleToggle}
        title={enabled ? 'Disable notifications' : 'Enable notifications'}
      >
        {enabled && permission === 'granted' ? (
          <Bell className="h-4 w-4 text-primary" />
        ) : (
          <BellOff className="h-4 w-4 text-muted-foreground" />
        )}
      </Button>
    );
  }

  // Show banner to request permission
  if (!showBanner) {
    return null;
  }

  return (
    <div
      className={cn(
        'flex items-center gap-3 px-4 py-2 bg-primary/10 border-b border-primary/20',
        'animate-fade-in'
      )}
    >
      <Bell className="h-5 w-5 text-primary shrink-0" />
      <p className="text-sm flex-1">
        Enable notifications to get alerts when {providerLabel} needs your input or finishes a task
      </p>
      <div className="flex items-center gap-2 shrink-0">
        <Button size="sm" variant="default" onClick={handleEnable}>
          Enable
        </Button>
        <Button size="sm" variant="ghost" onClick={handleDismiss}>
          <X className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
