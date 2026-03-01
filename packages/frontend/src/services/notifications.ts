// Browser notification service for the WebUI
import { useProviderStore } from '@/stores/providerStore';
import { UI_PROVIDER_META } from '@/lib/providers';

export type NotificationType = 'permission_request' | 'task_complete' | 'needs_input' | 'error';

interface NotificationOptions {
  title: string;
  body: string;
  type: NotificationType;
  sessionId?: string;
  onClick?: () => void;
}

class NotificationService {
  private permission: NotificationPermission = 'default';
  private enabled: boolean = true;

  constructor() {
    // Check if notifications are supported
    if ('Notification' in window) {
      this.permission = Notification.permission;
    }
  }

  // Request permission from user
  async requestPermission(): Promise<boolean> {
    if (!('Notification' in window)) {
      console.log('This browser does not support notifications');
      return false;
    }

    if (this.permission === 'granted') {
      return true;
    }

    if (this.permission !== 'denied') {
      const result = await Notification.requestPermission();
      this.permission = result;
      return result === 'granted';
    }

    return false;
  }

  // Check if notifications are available and permitted
  isAvailable(): boolean {
    return 'Notification' in window && this.permission === 'granted' && this.enabled;
  }

  // Enable/disable notifications
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    localStorage.setItem('notifications_enabled', String(enabled));
  }

  // Check if notifications are enabled
  isEnabled(): boolean {
    const stored = localStorage.getItem('notifications_enabled');
    if (stored !== null) {
      this.enabled = stored === 'true';
    }
    return this.enabled;
  }

  // Show a notification
  show(options: NotificationOptions): void {
    // Don't show if document is focused (user is looking at the app)
    if (document.hasFocus()) {
      return;
    }

    if (!this.isAvailable() || !this.isEnabled()) {
      return;
    }

    const icon = this.getIcon(options.type);
    const tag = options.sessionId ? `claude-${options.sessionId}` : 'claude-notification';

    const notification = new Notification(options.title, {
      body: options.body,
      icon,
      tag, // Replace notifications with same tag
      requireInteraction: options.type === 'permission_request', // Keep permission requests visible
    });

    notification.onclick = () => {
      window.focus();
      notification.close();
      options.onClick?.();
    };

    // Auto-close after 10 seconds for non-permission requests
    if (options.type !== 'permission_request') {
      setTimeout(() => notification.close(), 10000);
    }
  }

  // Get icon based on notification type
  private getIcon(type: NotificationType): string {
    const providerLabel = UI_PROVIDER_META[useProviderStore.getState().uiProvider].label;
    const providerInitial = providerLabel.slice(0, 1).toUpperCase();
    // Return a data URI for a simple icon based on type
    const colors: Record<NotificationType, string> = {
      permission_request: '#f59e0b', // amber
      task_complete: '#22c55e', // green
      needs_input: '#3b82f6', // blue
      error: '#ef4444', // red
    };

    const color = colors[type];

    // Create a simple SVG icon as data URI
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="${color}">
      <circle cx="12" cy="12" r="10"/>
      <text x="12" y="16" text-anchor="middle" fill="white" font-size="12" font-family="sans-serif">${providerInitial}</text>
    </svg>`;

    return `data:image/svg+xml,${encodeURIComponent(svg)}`;
  }

  // Convenience methods for different notification types
  notifyPermissionRequest(sessionId: string, toolNames: string[]): void {
    const providerLabel = UI_PROVIDER_META[useProviderStore.getState().uiProvider].label;
    this.show({
      title: 'Permission Required',
      body: `${providerLabel} wants to use: ${toolNames.join(', ')}`,
      type: 'permission_request',
      sessionId,
      onClick: () => {
        // Focus window and scroll to permission card
        window.focus();
      },
    });
  }

  notifyTaskComplete(sessionId: string, summary?: string): void {
    const providerLabel = UI_PROVIDER_META[useProviderStore.getState().uiProvider].label;
    this.show({
      title: 'Task Complete',
      body: summary || `${providerLabel} has finished the task`,
      type: 'task_complete',
      sessionId,
    });
  }

  notifyNeedsInput(sessionId: string, message?: string): void {
    const providerLabel = UI_PROVIDER_META[useProviderStore.getState().uiProvider].label;
    this.show({
      title: 'Input Needed',
      body: message || `${providerLabel} is waiting for your input`,
      type: 'needs_input',
      sessionId,
    });
  }

  notifyError(sessionId: string, error: string): void {
    this.show({
      title: 'Error',
      body: error,
      type: 'error',
      sessionId,
    });
  }
}

export const notificationService = new NotificationService();
