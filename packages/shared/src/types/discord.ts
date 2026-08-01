export type DiscordAlertSeverity = 'info' | 'warning' | 'error' | 'critical';

export type DiscordAlertTransport = 'webhook' | 'bot';

export type DiscordGatewayMode = 'alerts_only' | 'supervisor' | 'autonomous';

export type DiscordMaintenancePolicy = 'approval_required' | 'session_mode' | 'autonomous_allowed';

export type DiscordAlertEventType =
  | 'discord.test'
  | 'session.error'
  | 'session.permission_requested'
  | 'session.needs_input'
  | 'watchdog.incident'
  | 'delegation.error'
  | 'rebuild.failed'
  | 'goal.created'
  | 'goal.updated'
  | 'goal.completed';

export type DiscordOutboxStatus = 'pending' | 'sending' | 'sent' | 'failed' | 'disabled';

export interface DiscordIntegrationSettings {
  enabled: boolean;
  configured: boolean;
  transport: DiscordAlertTransport;
  webhookConfigured: boolean;
  webhookUrlPreview: string | null;
  webhookUrlFromEnv: boolean;
  botTokenConfigured: boolean;
  botTokenFromEnv: boolean;
  channelId: string | null;
  channelIdFromEnv: boolean;
  channelLabel: string | null;
  minSeverity: DiscordAlertSeverity;
  gatewayMode: DiscordGatewayMode;
  maintenancePolicy: DiscordMaintenancePolicy;
  inboundJobsEnabled: boolean;
  criticalRoleId: string | null;
  outboxPending: number;
  outboxFailed: number;
  lastSentAt: string | null;
  lastError: string | null;
}

export interface DiscordIntegrationSettingsUpdate {
  enabled?: boolean;
  transport?: DiscordAlertTransport;
  webhookUrl?: string | null;
  clearWebhookUrl?: boolean;
  botToken?: string | null;
  clearBotToken?: boolean;
  channelId?: string | null;
  channelLabel?: string | null;
  minSeverity?: DiscordAlertSeverity;
  gatewayMode?: DiscordGatewayMode;
  maintenancePolicy?: DiscordMaintenancePolicy;
  inboundJobsEnabled?: boolean;
  criticalRoleId?: string | null;
}

export interface DiscordOutboxItem {
  id: string;
  userId: string | null;
  sessionId: string | null;
  eventType: DiscordAlertEventType;
  severity: DiscordAlertSeverity;
  status: DiscordOutboxStatus;
  title: string;
  summary: string;
  attempts: number;
  nextAttemptAt: string | null;
  sentAt: string | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DiscordTestResult {
  queued: boolean;
  sent: boolean;
  outboxId: string | null;
  error: string | null;
}
