import type { Server as SocketServer } from 'socket.io';
import path from 'path';
import fs from 'fs';
import { randomUUID } from 'crypto';
import type {
  WatchdogConfig,
  WatchdogCliConfig,
  WatchdogRule,
  WatchdogDecision,
  WatchdogStatus,
  WatchdogCondition,
  WatchdogAutonomousProfile,
  TelegramConfig,
  SessionGoal,
  WatchdogSessionState,
  WatchdogInterMessage,
  SessionActivityEntry,
} from '@claude-code-webui/shared';
import { DEFAULT_WATCHDOG_RULES } from '@claude-code-webui/shared';
import { db } from '../../db';
import type { ClaudeProcessManager } from '../claude/ClaudeProcessManager';
import { TelegramBotService } from './TelegramBotService';

interface SessionStats {
  errorCount: number;
  lastErrorTime: number;
  tokenUsage: number;
  startTime: number;
  toolCallCount: number;
}

interface PendingPermissionRequest {
  requestId: string;
  sessionId: string;
  toolName: string;
  toolInput: unknown;
  description?: string;
  timestamp: number;
}

interface WatchdogAuditSummary {
  sessionId?: string;
  profile: WatchdogAutonomousProfile | 'mixed';
  decisionsConsidered: number;
  automaticDecisions: number;
  manualDecisions: number;
  actions: Record<'approve' | 'deny' | 'pause' | 'notify', number>;
  topReasons: Array<{ reason: string; count: number }>;
  recentAutomaticDecisions: WatchdogDecision[];
}

export class WatchdogService {
  private static readonly SAFE_READ_ONLY_TOOLS = new Set([
    'read',
    'glob',
    'grep',
    'webfetch',
    'websearch',
  ]);

  private static readonly BALANCED_WRITE_TOOLS = new Set([
    'write',
    'edit',
    'multiedit',
    'todowrite',
  ]);

  private static readonly AGGRESSIVE_EXTRA_WRITE_TOOLS = new Set([
    'task',
  ]);

  private static readonly READ_ONLY_GIT_SUBCOMMANDS = new Set([
    'status',
    'diff',
    'log',
    'show',
    'branch',
    'rev-parse',
    'rev-list',
    'ls-files',
    'remote',
    'tag',
  ]);

  private static readonly SAFE_BASH_PREFIXES = [
    'pwd',
    'ls',
    'cat',
    'head',
    'tail',
    'wc',
    'echo',
    'printf',
    'whoami',
    'date',
    'find',
    'grep',
    'sed',
    'awk',
  ];

  private static readonly DANGEROUS_BASH_PATTERNS = [
    /\bsudo\b/i,
    /\brm\s+-rf?\s+\/(\s|$|\*)/i,
    /\brm\s+-rf?\s+(--no-preserve-root\s+)?(\.|\.\.|~|\/\*|\*)(\s|$)/i,
    /\bmkfs(\.[a-z0-9]+)?\b/i,
    /\bdd\s+if=/i,
    /\bshutdown\b/i,
    /\breboot\b/i,
    /\bpoweroff\b/i,
    /\bcurl\s+[^|]+\|\s*(bash|sh)\b/i,
    /\bwget\s+[^|]+\|\s*(bash|sh)\b/i,
    /:\(\)\s*{\s*:\s*\|\s*:\s*;\s*}\s*;/,
  ];

  private io: SocketServer;
  private globalConfig: WatchdogConfig;
  private sessionConfigs: Map<string, WatchdogConfig> = new Map();
  private sessionStats: Map<string, SessionStats> = new Map();
  private monitoredSessions: Map<string, WatchdogSessionState> = new Map();
  private decisions: WatchdogDecision[] = [];
  private pausedSessions: Set<string> = new Set();

  // CLI integration fields
  private processManager: ClaudeProcessManager | null = null;
  private responseCollectors: Map<string, string[]> = new Map();
  private cliSessionId: string | null = null;
  private cliInitialized = false;

  // Inter-instance communication
  private sessionActivity: Map<string, SessionActivityEntry[]> = new Map();
  private interMessages: WatchdogInterMessage[] = [];
  private static readonly MAX_ACTIVITY_PER_SESSION = 50;
  private static readonly MAX_INTER_MESSAGES = 200;

  // Active goal monitoring
  private evaluatingGoals: Set<string> = new Set(); // goalIds currently being evaluated
  private pendingEvaluations: Map<string, NodeJS.Timeout> = new Map(); // sessionId → debounce timer
  private telegramBot: TelegramBotService | null = null;

  // Active monitoring loop
  private monitoringInterval: NodeJS.Timeout | null = null;
  private lastKnownRunning: Set<string> = new Set(); // sessions that were running last check
  private idleNotified: Set<string> = new Set(); // sessions already notified as idle
  private turnCompleteTimers: Map<string, NodeJS.Timeout> = new Map(); // debounce turn-complete notifications
  private static readonly MONITOR_INTERVAL_MS = 60_000; // check every 60s
  private static readonly IDLE_THRESHOLD_MS = 10 * 60_000; // 10 min idle = notification
  private static readonly TURN_NOTIFY_DEBOUNCE_MS = 30_000; // 30s after last turn → notify

  constructor(io: SocketServer, processManager?: ClaudeProcessManager) {
    this.io = io;
    this.processManager = processManager || null;
    this.globalConfig = this.loadGlobalConfig();
    this.loadSessionConfigs();
    this.loadMonitoredSessions();

    if (this.processManager) {
      this.setupCliEventListeners();
    }

    // Cleanup old decisions every hour
    setInterval(() => this.cleanupOldDecisions(), 60 * 60 * 1000);

    // Auto-start Telegram bot if configured
    if (this.globalConfig.telegram?.enabled && this.globalConfig.telegram.botToken && this.globalConfig.telegram.chatId) {
      this.startTelegramBot();
    }

    // Start active monitoring loop
    this.startActiveMonitoring();
  }

  private setupCliEventListeners(): void {
    if (!this.processManager) return;

    // Collect responses for CLI turns (own session + any session we're waiting on)
    this.processManager.events.on('assistantMessage', (sessionId: string, content: string) => {
      const collector = this.responseCollectors.get(sessionId);
      if (collector) {
        collector.push(content);
      }

      // Track activity for all monitored sessions
      if (this.monitoredSessions.has(sessionId) && sessionId !== this.cliSessionId) {
        this.recordSessionActivity(sessionId, 'message', content.substring(0, 200));
        this.touchMonitoredSession(sessionId);
      }
    });

    // Track turn completions for cost/token monitoring + goal evaluation trigger
    this.processManager.events.on('turnComplete', (sessionId: string, data: { inputTokens: number; outputTokens: number }) => {
      if (this.monitoredSessions.has(sessionId) && sessionId !== this.cliSessionId) {
        this.recordSessionActivity(sessionId, 'status',
          `Turn complete: ${data.inputTokens} in / ${data.outputTokens} out`
        );
        this.touchMonitoredSession(sessionId);
        this.idleNotified.delete(sessionId); // reset idle flag on activity

        // Debounced turn-complete notification: if no new turn starts within 30s,
        // assume Claude is done and waiting for user. This avoids spam during
        // multi-turn autonomous work.
        if (data.outputTokens > 200) {
          this.scheduleTurnCompleteNotification(sessionId);
        }

        // Trigger goal evaluation if active goals exist and output was non-trivial
        if (data.outputTokens > 100 && this.hasActiveMonitoredGoals(sessionId)) {
          this.scheduleGoalEvaluation(sessionId);
        }
      }
    });

    // Listen for user messages to detect goals from session chat
    this.processManager.events.on('userMessage', (sessionId: string, message: string) => {
      if (!this.monitoredSessions.has(sessionId)) return;
      if (sessionId === this.cliSessionId) return;

      // Cancel pending "waiting for input" notification — user already responded
      const pendingTimer = this.turnCompleteTimers.get(sessionId);
      if (pendingTimer) {
        clearTimeout(pendingTimer);
        this.turnCompleteTimers.delete(sessionId);
      }

      if (!this.globalConfig.goalMonitoring?.autoCreateFromSession) return;
      if (!this.globalConfig.goalMonitoring?.enabled) return;
      if (message.length < 20) return;

      // Don't detect goals from Watchdog's own injected messages
      if (message.startsWith('[Watchdog]')) return;

      this.detectGoalFromMessage(sessionId, message).catch(err => {
        console.error('[WATCHDOG] Goal detection failed:', err);
      });
    });
  }

  private recordSessionActivity(sessionId: string, type: SessionActivityEntry['type'], summary: string): void {
    let entries = this.sessionActivity.get(sessionId);
    if (!entries) {
      entries = [];
      this.sessionActivity.set(sessionId, entries);
    }
    entries.push({
      sessionId,
      timestamp: Date.now(),
      type,
      summary,
    });
    // Rolling window
    if (entries.length > WatchdogService.MAX_ACTIVITY_PER_SESSION) {
      entries.splice(0, entries.length - WatchdogService.MAX_ACTIVITY_PER_SESSION);
    }
  }

  private sanitizeAutonomousProfile(profile: unknown): WatchdogAutonomousProfile {
    return profile === 'aggressive' ? 'aggressive' : 'balanced';
  }

  private normalizeConfig(raw: Partial<WatchdogConfig> | null | undefined): WatchdogConfig {
    return {
      enabled: raw?.enabled === true,
      sessionId: raw?.sessionId,
      autonomousProfile: this.sanitizeAutonomousProfile(raw?.autonomousProfile),
      rules: Array.isArray(raw?.rules) ? raw.rules : DEFAULT_WATCHDOG_RULES,
      pauseOnErrorThreshold: raw?.pauseOnErrorThreshold,
      maxTokensPerSession: raw?.maxTokensPerSession,
      maxRuntimeMinutes: raw?.maxRuntimeMinutes,
      notifyWebhook: raw?.notifyWebhook,
      logDecisions: raw?.logDecisions ?? true,
      telegram: raw?.telegram,
      cli: raw?.cli ? {
        enabled: raw.cli.enabled === true,
        cliProvider: raw.cli.cliProvider || 'claude',
        model: raw.cli.model,
        workingDirectory: raw.cli.workingDirectory,
        sessionId: raw.cli.sessionId,
        useForPermissions: raw.cli.useForPermissions === true,
        useForChat: raw.cli.useForChat === true,
        permissionTimeoutMs: raw.cli.permissionTimeoutMs,
      } : undefined,
      goalMonitoring: {
        enabled: raw?.goalMonitoring?.enabled === true,
        maxIterationsPerGoal: raw?.goalMonitoring?.maxIterationsPerGoal || 20,
        evaluationDelayMs: raw?.goalMonitoring?.evaluationDelayMs || 3000,
        autoCreateFromSession: raw?.goalMonitoring?.autoCreateFromSession === true,
      },
    };
  }

  private loadGlobalConfig(): WatchdogConfig {
    try {
      const row = db.prepare(
        "SELECT value FROM app_config WHERE key = 'watchdog_config'"
      ).get() as { value: string } | undefined;
      if (row?.value) {
        return this.normalizeConfig(JSON.parse(row.value) as WatchdogConfig);
      }
    } catch (err) {
      console.error('[WATCHDOG] Failed to load global config:', err);
    }
    return this.normalizeConfig({
      enabled: false,
      rules: DEFAULT_WATCHDOG_RULES,
      logDecisions: true,
      autonomousProfile: 'balanced',
    });
  }

  private saveGlobalConfig(): void {
    try {
      db.prepare(
        "INSERT OR REPLACE INTO app_config (key, value) VALUES ('watchdog_config', ?)"
      ).run(JSON.stringify(this.globalConfig));
    } catch (err) {
      console.error('[WATCHDOG] Failed to save global config:', err);
    }
  }

  private loadSessionConfigs(): void {
    try {
      const rows = db.prepare(
        "SELECT key, value FROM app_config WHERE key LIKE 'watchdog_session_%'"
      ).all() as { key: string; value: string }[];
      for (const row of rows) {
        const sessionId = row.key.replace('watchdog_session_', '');
        this.sessionConfigs.set(sessionId, this.normalizeConfig(JSON.parse(row.value) as WatchdogConfig));
      }
    } catch (err) {
      console.error('[WATCHDOG] Failed to load session configs:', err);
    }
  }

  private saveSessionConfig(sessionId: string): void {
    try {
      const config = this.sessionConfigs.get(sessionId);
      if (config) {
        db.prepare(
          "INSERT OR REPLACE INTO app_config (key, value) VALUES (?, ?)"
        ).run('watchdog_session_' + sessionId, JSON.stringify(config));
      } else {
        db.prepare(
          "DELETE FROM app_config WHERE key = ?"
        ).run('watchdog_session_' + sessionId);
      }
    } catch (err) {
      console.error('[WATCHDOG] Failed to save session config:', err);
    }
  }

  private loadMonitoredSessions(): void {
    try {
      const row = db.prepare(
        "SELECT value FROM app_config WHERE key = 'watchdog_monitored_sessions'"
      ).get() as { value: string } | undefined;
      if (row?.value) {
        const sessions: WatchdogSessionState[] = JSON.parse(row.value);
        for (const s of sessions) {
          this.monitoredSessions.set(s.sessionId, s);
        }
      }
    } catch (err) {
      console.error('[WATCHDOG] Failed to load monitored sessions:', err);
    }
  }

  private saveMonitoredSessions(): void {
    try {
      const sessions = Array.from(this.monitoredSessions.values());
      db.prepare(
        "INSERT OR REPLACE INTO app_config (key, value) VALUES ('watchdog_monitored_sessions', ?)"
      ).run(JSON.stringify(sessions));
    } catch (err) {
      console.error('[WATCHDOG] Failed to save monitored sessions:', err);
    }
  }

  private getEffectiveConfig(sessionId: string): WatchdogConfig {
    const sessionConfig = this.sessionConfigs.get(sessionId);
    if (sessionConfig) {
      return sessionConfig;
    }
    return this.globalConfig;
  }

  private getOrCreateSessionStats(sessionId: string): SessionStats {
    const existing = this.sessionStats.get(sessionId);
    if (existing) {
      return existing;
    }
    const stats: SessionStats = {
      errorCount: 0,
      lastErrorTime: 0,
      tokenUsage: 0,
      startTime: Date.now(),
      toolCallCount: 0,
    };
    this.sessionStats.set(sessionId, stats);
    return stats;
  }

  private touchMonitoredSession(sessionId: string, persist = false): void {
    const monitoredState = this.monitoredSessions.get(sessionId);
    if (!monitoredState) return;
    monitoredState.lastActivity = Date.now();
    if (persist) {
      this.saveMonitoredSessions();
    }
  }

  private normalizeToolName(toolName: string): string {
    return toolName.replace(/[_-\s]/g, '').toLowerCase();
  }

  private getInputString(toolInput: unknown, ...keys: string[]): string {
    if (!toolInput || typeof toolInput !== 'object') return '';
    const input = toolInput as Record<string, unknown>;
    for (const key of keys) {
      const value = input[key];
      if (typeof value === 'string' && value.trim().length > 0) {
        return value.trim();
      }
    }
    return '';
  }

  private isDangerousBashCommand(command: string): boolean {
    if (!command.trim()) return false;
    return WatchdogService.DANGEROUS_BASH_PATTERNS.some((pattern) => pattern.test(command));
  }

  private isReadOnlyGitCommand(command: string): boolean {
    const trimmed = command.trim();
    if (!trimmed.toLowerCase().startsWith('git ')) return false;
    const parts = trimmed.split(/\s+/);
    const subcommand = (parts[1] || '').toLowerCase();
    return WatchdogService.READ_ONLY_GIT_SUBCOMMANDS.has(subcommand);
  }

  private isSimpleSafeBashCommand(command: string): boolean {
    const trimmed = command.trim();
    if (!trimmed) return false;
    if (/[;&|><`$()]/.test(trimmed)) return false;
    if (this.isReadOnlyGitCommand(trimmed)) return true;
    return WatchdogService.SAFE_BASH_PREFIXES.some((prefix) =>
      trimmed.toLowerCase() === prefix || trimmed.toLowerCase().startsWith(prefix + ' ')
    );
  }

  private isMutatingBashCommand(command: string): boolean {
    const normalized = command.toLowerCase();
    return /\b(rm|mv|cp|mkdir|rmdir|touch|truncate|chmod|chown|ln)\b/.test(normalized)
      || /\bsed\s+-i\b/.test(normalized)
      || /\bperl\s+-i\b/.test(normalized)
      || />/.test(command)
      || /\btee\b/.test(normalized);
  }

  private extractAbsoluteUnixPaths(command: string): string[] {
    const matches = command.match(/(?:^|\s)(\/[^\s"'`|;><]+)/g);
    if (!matches) return [];
    return matches.map((m) => m.trim());
  }

  private hasMutatingExternalPath(sessionId: string, command: string): boolean {
    if (!this.isMutatingBashCommand(command)) return false;
    const absolutePaths = this.extractAbsoluteUnixPaths(command);
    if (absolutePaths.length === 0) return false;
    return absolutePaths.some((p) => !this.isPathWithinSessionWorkspace(sessionId, p));
  }

  private getAutonomousProfile(sessionId: string): WatchdogAutonomousProfile {
    const config = this.getEffectiveConfig(sessionId);
    return this.sanitizeAutonomousProfile(config.autonomousProfile);
  }

  private resolveSessionWorkingDirectory(sessionId: string): string | null {
    try {
      const row = db.prepare('SELECT working_directory FROM sessions WHERE id = ?').get(sessionId) as
        | { working_directory: string }
        | undefined;
      if (!row?.working_directory) return null;
      return path.resolve(row.working_directory);
    } catch {
      return null;
    }
  }

  private isPathWithinSessionWorkspace(sessionId: string, rawPath: string): boolean {
    if (!rawPath.trim()) return true;
    const workspaceRoot = this.resolveSessionWorkingDirectory(sessionId);
    if (!workspaceRoot) return true;
    const resolvedTarget = path.resolve(workspaceRoot, rawPath);
    return resolvedTarget === workspaceRoot || resolvedTarget.startsWith(workspaceRoot + path.sep);
  }

  private shouldUseAutonomousFallback(sessionId: string): boolean {
    const sessionConfig = this.sessionConfigs.get(sessionId);
    if (sessionConfig) {
      return sessionConfig.enabled;
    }
    const monitored = this.monitoredSessions.get(sessionId);
    if (monitored) {
      return monitored.monitored;
    }
    return this.globalConfig.enabled;
  }

  private buildAutonomousFallbackDecision(request: PendingPermissionRequest): WatchdogDecision | null {
    if (!this.shouldUseAutonomousFallback(request.sessionId)) {
      return null;
    }

    const normalizedTool = this.normalizeToolName(request.toolName);
    const profile = this.getAutonomousProfile(request.sessionId);
    const writeTools = new Set(WatchdogService.BALANCED_WRITE_TOOLS);
    if (profile === 'aggressive') {
      for (const tool of WatchdogService.AGGRESSIVE_EXTRA_WRITE_TOOLS) {
        writeTools.add(tool);
      }
    }
    const decisionBase = {
      id: randomUUID(),
      timestamp: Date.now(),
      sessionId: request.sessionId,
      requestId: request.requestId,
      toolName: request.toolName,
      toolInput: request.toolInput,
      automatic: true,
    } as const;

    if (WatchdogService.SAFE_READ_ONLY_TOOLS.has(normalizedTool)) {
      return {
        ...decisionBase,
        action: 'approve',
        reason: 'Auto-approved read-only tool by watchdog autonomy',
      };
    }

    if (writeTools.has(normalizedTool)) {
      const targetPath = this.getInputString(request.toolInput, 'file_path', 'path');
      if (targetPath && !this.isPathWithinSessionWorkspace(request.sessionId, targetPath)) {
        return {
          ...decisionBase,
          action: 'deny',
          reason: `Blocked write outside session workspace: ${targetPath}`,
        };
      }
      return {
        ...decisionBase,
        action: 'approve',
        reason: `Auto-approved workspace write/edit by ${profile} profile`,
      };
    }

    if (normalizedTool === 'bash') {
      const command = this.getInputString(request.toolInput, 'command');
      if (command && this.hasMutatingExternalPath(request.sessionId, command)) {
        return {
          ...decisionBase,
          action: 'deny',
          reason: 'Blocked shell mutation outside session workspace',
        };
      }
      if (command && this.isSimpleSafeBashCommand(command)) {
        return {
          ...decisionBase,
          action: 'approve',
          reason: `Auto-approved safe shell command by ${profile} profile`,
        };
      }
      if (profile === 'aggressive' && command && !this.isDangerousBashCommand(command)) {
        return {
          ...decisionBase,
          action: 'approve',
          reason: 'Auto-approved non-dangerous shell command by aggressive profile',
        };
      }
    }

    return null;
  }

  isEnabled(sessionId: string): boolean {
    const config = this.getEffectiveConfig(sessionId);
    return config.enabled;
  }

  initSession(sessionId: string): void {
    this.getOrCreateSessionStats(sessionId);
  }

  recordError(sessionId: string): void {
    const stats = this.getOrCreateSessionStats(sessionId);
    stats.errorCount++;
    stats.lastErrorTime = Date.now();
    const config = this.getEffectiveConfig(sessionId);
    if (config.pauseOnErrorThreshold && stats.errorCount >= config.pauseOnErrorThreshold) {
      this.pauseSession(sessionId, 'Too many consecutive errors');
    }
    // Update monitored session state
    const ms = this.monitoredSessions.get(sessionId);
    if (ms) {
      ms.errorCount = (ms.errorCount || 0) + 1;
      this.touchMonitoredSession(sessionId, true);
      this.recordSessionActivity(sessionId, 'error', 'Error #' + ms.errorCount);
      // Telegram notification
      this.sendTelegramNotification('error', 'Error detected', sessionId);
    } else {
      this.touchMonitoredSession(sessionId);
    }
  }

  recordTokenUsage(sessionId: string, tokens: number): void {
    const stats = this.getOrCreateSessionStats(sessionId);
    stats.tokenUsage += tokens;
    const config = this.getEffectiveConfig(sessionId);
    if (config.maxTokensPerSession && stats.tokenUsage >= config.maxTokensPerSession) {
      this.pauseSession(sessionId, 'Token limit exceeded');
    }
    const ms = this.monitoredSessions.get(sessionId);
    if (ms) {
      ms.tokenUsage = (ms.tokenUsage || 0) + tokens;
      this.touchMonitoredSession(sessionId);
    }
  }

  recordToolCall(sessionId: string): void {
    const stats = this.getOrCreateSessionStats(sessionId);
    stats.toolCallCount++;
    this.touchMonitoredSession(sessionId);
  }

  clearErrors(sessionId: string): void {
    const stats = this.sessionStats.get(sessionId);
    if (stats) {
      stats.errorCount = 0;
      stats.lastErrorTime = 0;
    }
    this.touchMonitoredSession(sessionId);
  }

  pauseSession(sessionId: string, reason: string): void {
    this.pausedSessions.add(sessionId);
    const ms = this.monitoredSessions.get(sessionId);
    if (ms) {
      ms.paused = true;
      ms.pauseReason = reason;
      this.saveMonitoredSessions();
    }
    const decision: WatchdogDecision = {
      id: randomUUID(),
      timestamp: Date.now(),
      sessionId,
      toolName: 'session',
      action: 'pause',
      reason,
      automatic: true,
    };
    this.logDecision(decision);
    this.io.to('session:' + sessionId).emit('session:watchdog_pause', { sessionId, reason });
    this.sendTelegramNotification('pause', 'Session paused: ' + reason, sessionId);
    console.log('[WATCHDOG] Session ' + sessionId + ' paused: ' + reason);
  }

  resumeSession(sessionId: string): void {
    this.pausedSessions.delete(sessionId);
    this.clearErrors(sessionId);
    const ms = this.monitoredSessions.get(sessionId);
    if (ms) {
      ms.paused = false;
      ms.pauseReason = undefined;
      this.saveMonitoredSessions();
    }
    this.io.to('session:' + sessionId).emit('session:watchdog_resume', { sessionId });
    console.log('[WATCHDOG] Session ' + sessionId + ' resumed');
  }

  isSessionPaused(sessionId: string): boolean {
    return this.pausedSessions.has(sessionId);
  }

  // ===== Session Monitoring =====

  setSessionMonitored(sessionId: string, monitored: boolean): void {
    if (monitored) {
      this.initSession(sessionId);
      if (!this.monitoredSessions.has(sessionId)) {
        this.monitoredSessions.set(sessionId, {
          sessionId,
          monitored: true,
          goals: [],
          lastActivity: Date.now(),
          errorCount: 0,
          tokenUsage: 0,
          startTime: Date.now(),
          paused: false,
        });
      } else {
        const ms = this.monitoredSessions.get(sessionId)!;
        ms.monitored = true;
      }
    } else {
      const ms = this.monitoredSessions.get(sessionId);
      if (ms) {
        ms.monitored = false;
      }
    }
    this.saveMonitoredSessions();
  }

  getMonitoredSessions(): WatchdogSessionState[] {
    return Array.from(this.monitoredSessions.values()).filter(s => s.monitored);
  }

  // ===== Goals =====

  addGoal(sessionId: string, goal: Partial<Omit<SessionGoal, 'id' | 'sessionId' | 'createdAt' | 'updatedAt'>> & { description: string }): SessionGoal {
    const ms = this.monitoredSessions.get(sessionId);
    const newGoal: SessionGoal = {
      priority: 'medium',
      status: 'pending',
      autoMonitor: false,
      iterationCount: 0,
      ...goal,
      id: randomUUID(),
      sessionId,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    if (ms) {
      ms.goals.push(newGoal);
      this.saveMonitoredSessions();
    }
    return newGoal;
  }

  updateGoal(sessionId: string, goalId: string, update: Partial<SessionGoal>): SessionGoal | null {
    const ms = this.monitoredSessions.get(sessionId);
    if (!ms) return null;
    const goal = ms.goals.find(g => g.id === goalId);
    if (!goal) return null;
    Object.assign(goal, update, { updatedAt: Date.now() });
    this.saveMonitoredSessions();
    // Telegram notification on status change
    if (update.status) {
      this.sendTelegramNotification('goalProgress', 'Goal "' + goal.description.substring(0, 50) + '" → ' + update.status, sessionId);
    }
    return goal;
  }

  deleteGoal(sessionId: string, goalId: string): boolean {
    const ms = this.monitoredSessions.get(sessionId);
    if (!ms) return false;
    const idx = ms.goals.findIndex(g => g.id === goalId);
    if (idx < 0) return false;
    ms.goals.splice(idx, 1);
    this.saveMonitoredSessions();
    return true;
  }

  getGoals(sessionId: string): SessionGoal[] {
    return this.monitoredSessions.get(sessionId)?.goals || [];
  }

  // ===== Telegram =====

  async sendTelegramNotification(type: string, message: string, sessionId?: string): Promise<void> {
    const telegram = this.globalConfig.telegram;
    if (!telegram?.enabled || !telegram.botToken || !telegram.chatId) return;

    // Check notification preferences
    if (type === 'approve' && !telegram.notifyOnApprove) return;
    if (type === 'deny' && !telegram.notifyOnDeny) return;
    if (type === 'pause' && !telegram.notifyOnPause) return;
    if (type === 'error' && !telegram.notifyOnError) return;
    if (type === 'goalProgress' && !telegram.notifyOnGoalProgress) return;

    const icon = type === 'approve' ? '✅' : type === 'deny' ? '❌' : type === 'pause' ? '⏸️' : type === 'error' ? '🚨' : '📋';
    const sessionPrefix = sessionId ? '[' + this.resolveSessionName(sessionId) + '] ' : '';

    try {
      const url = 'https://api.telegram.org/bot' + telegram.botToken + '/sendMessage';
      await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: telegram.chatId,
          text: icon + ' ' + sessionPrefix + message,
          parse_mode: 'HTML',
        }),
      });
    } catch (err) {
      console.error('[WATCHDOG] Telegram notification failed:', err);
    }
  }

  async testTelegramConnection(): Promise<{ success: boolean; error?: string }> {
    const telegram = this.globalConfig.telegram;
    if (!telegram?.botToken || !telegram?.chatId) {
      return { success: false, error: 'Bot token or chat ID not configured' };
    }
    try {
      const url = 'https://api.telegram.org/bot' + telegram.botToken + '/sendMessage';
      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: telegram.chatId,
          text: '🤖 *Watchdog Test*\nConnection successful! Notifications are working.',
          parse_mode: 'Markdown',
        }),
      });
      const data = await resp.json() as { ok: boolean; description?: string };
      if (data.ok) {
        return { success: true };
      }
      return { success: false, error: data.description || 'Unknown error' };
    } catch (err) {
      return { success: false, error: String(err) };
    }
  }

  isTelegramConnected(): boolean {
    const t = this.globalConfig.telegram;
    return !!(t?.enabled && t?.botToken && t?.chatId);
  }

  setTelegramConfig(config: TelegramConfig): void {
    this.globalConfig.telegram = config;
    this.saveGlobalConfig();
    // Restart bot with new config
    this.stopTelegramBot();
    if (config.enabled && config.botToken && config.chatId) {
      this.startTelegramBot();
    }
  }

  startTelegramBot(): void {
    const telegram = this.globalConfig.telegram;
    if (!telegram?.enabled || !telegram.botToken || !telegram.chatId) return;
    if (this.telegramBot?.isRunning()) return;
    this.telegramBot = new TelegramBotService(this);
    this.telegramBot.start(telegram.botToken, telegram.chatId);
  }

  stopTelegramBot(): void {
    if (this.telegramBot) {
      this.telegramBot.stop();
      this.telegramBot = null;
    }
  }

  isTelegramBotRunning(): boolean {
    return this.telegramBot?.isRunning() ?? false;
  }

  getTelegramConfig(): TelegramConfig | undefined {
    return this.globalConfig.telegram;
  }

  // ===== Active Monitoring Loop =====

  private startActiveMonitoring(): void {
    if (this.monitoringInterval) return;
    this.monitoringInterval = setInterval(() => {
      this.runMonitoringCheck().catch(err => {
        console.error('[WATCHDOG] Monitoring check error:', err);
      });
    }, WatchdogService.MONITOR_INTERVAL_MS);
    console.log('[WATCHDOG] Active monitoring started (interval: ' + (WatchdogService.MONITOR_INTERVAL_MS / 1000) + 's)');
  }

  private async runMonitoringCheck(): Promise<void> {
    if (!this.globalConfig.enabled) return;
    const telegram = this.globalConfig.telegram;
    if (!telegram?.enabled || !telegram.botToken || !telegram.chatId) return;

    const monitored = this.getMonitoredSessions();
    if (monitored.length === 0) return;

    const now = Date.now();
    const runningIds = this.processManager ? new Set(this.processManager.getRunningSessionIds()) : new Set<string>();

    for (const ms of monitored) {
      const sessionId = ms.sessionId;
      const isRunning = runningIds.has(sessionId);
      const wasRunning = this.lastKnownRunning.has(sessionId);
      const sessionName = this.resolveSessionName(sessionId);

      // Session started
      if (isRunning && !wasRunning) {
        this.lastKnownRunning.add(sessionId);
        this.idleNotified.delete(sessionId);
        await this.sendDirectTelegram(`▶️ [${sessionName}] Session gestartet`);
        continue;
      }

      // Session stopped
      if (!isRunning && wasRunning) {
        this.lastKnownRunning.delete(sessionId);
        this.idleNotified.delete(sessionId);
        await this.sendDirectTelegram(`⏹️ [${sessionName}] Session beendet`);
        continue;
      }

      // Idle detection — only once per idle phase
      if (isRunning && !this.idleNotified.has(sessionId)) {
        const activity = this.getSessionActivity(sessionId);
        const lastEntry = activity.length > 0 ? activity[activity.length - 1] : null;
        const lastTime = lastEntry?.timestamp || ms.lastActivity || ms.startTime;
        const idleMs = now - lastTime;

        if (idleMs >= WatchdogService.IDLE_THRESHOLD_MS) {
          const idleMin = Math.round(idleMs / 60_000);
          await this.sendDirectTelegram(
            `💤 [${sessionName}] Idle seit ${idleMin} Min — keine Aktivität`
          );
          this.idleNotified.add(sessionId);
        }
      }
      // Reset idle flag when activity resumes
      if (isRunning && this.idleNotified.has(sessionId)) {
        const activity = this.getSessionActivity(sessionId);
        const lastEntry = activity.length > 0 ? activity[activity.length - 1] : null;
        if (lastEntry && (now - lastEntry.timestamp) < WatchdogService.IDLE_THRESHOLD_MS) {
          this.idleNotified.delete(sessionId);
        }
      }
    }
  }

  /**
   * Debounced turn-complete notification. Resets on each new turn.
   * Only fires if Claude stays idle for TURN_NOTIFY_DEBOUNCE_MS after the last turn.
   */
  private scheduleTurnCompleteNotification(sessionId: string): void {
    // Clear previous timer for this session
    const existing = this.turnCompleteTimers.get(sessionId);
    if (existing) clearTimeout(existing);

    const timer = setTimeout(() => {
      this.turnCompleteTimers.delete(sessionId);
      const sessionName = this.resolveSessionName(sessionId);
      this.sendDirectTelegram(
        `✅ [${sessionName}] Arbeit abgeschlossen — wartet auf Input`
      ).catch(() => {});
    }, WatchdogService.TURN_NOTIFY_DEBOUNCE_MS);

    this.turnCompleteTimers.set(sessionId, timer);
  }

  /**
   * Called when a permission request falls through to manual approval.
   * Notifies via Telegram that user input is needed.
   */
  async notifyNeedsInput(sessionId: string, toolName: string, description?: string): Promise<void> {
    if (!this.monitoredSessions.has(sessionId)) return;
    const sessionName = this.resolveSessionName(sessionId);
    const desc = description ? ': ' + description.substring(0, 100) : '';
    await this.sendDirectTelegram(
      `🔔 [${sessionName}] Deine Freigabe wird benötigt\nTool: ${toolName}${desc}`
    );
  }

  /**
   * Send a Telegram message directly (bypasses notification type filtering).
   * Used for proactive monitoring updates that don't fit approve/deny/pause categories.
   */
  private async sendDirectTelegram(text: string): Promise<void> {
    const telegram = this.globalConfig.telegram;
    if (!telegram?.enabled || !telegram.botToken || !telegram.chatId) return;

    try {
      const url = 'https://api.telegram.org/bot' + telegram.botToken + '/sendMessage';
      await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: telegram.chatId,
          text,
          parse_mode: 'HTML',
        }),
      });
    } catch (err) {
      console.error('[WATCHDOG] Direct Telegram send failed:', err);
    }
  }

  // ===== Session Helpers =====

  resolveSessionName(sessionId: string): string {
    try {
      const row = db.prepare('SELECT name FROM sessions WHERE id = ?').get(sessionId) as { name: string } | undefined;
      return row?.name || sessionId.substring(0, 8) + '...';
    } catch {
      return sessionId.substring(0, 8) + '...';
    }
  }

  getAllSessions(): Array<{ id: string; name: string; status: string; workingDirectory: string; cliProvider: string }> {
    try {
      return db.prepare(
        'SELECT id, name, status, working_directory as workingDirectory, cli_provider as cliProvider FROM sessions ORDER BY updated_at DESC'
      ).all() as Array<{ id: string; name: string; status: string; workingDirectory: string; cliProvider: string }>;
    } catch {
      return [];
    }
  }

  // ===== CLI Integration =====

  private getCliConfig(): WatchdogCliConfig | undefined {
    return this.globalConfig.cli;
  }

  private isCliEnabled(): boolean {
    const cli = this.getCliConfig();
    return !!(cli?.enabled && this.processManager);
  }

  private generateWatchdogClaudeMd(): string {
    const profile = this.sanitizeAutonomousProfile(this.globalConfig.autonomousProfile);
    const rulesSummary = this.globalConfig.rules
      .filter(r => r.enabled)
      .map(r => `- ${r.name} (${r.condition.type} -> ${r.action.type})`)
      .join('\n');

    return `# Watchdog AI

Du bist der Watchdog — ein KI-gestützter Sicherheits- und Autonomie-Manager für Claude Code Sessions.

## Aufgabe
- Bewerte Permission-Anfragen und entscheide ob Tools ausgeführt werden dürfen
- Beantworte Fragen zum Status der überwachten Sessions
- Verwalte Session-Goals und überwache Fortschritt

## Permission-Entscheidungen
Wenn du eine Permission-Anfrage bekommst, antworte im Format:
APPROVE: [Begründung]
oder
DENY: [Begründung]

Berücksichtige:
- Aktuelles Profil: ${profile}
- ${profile === 'balanced' ? 'Balanced ist restriktiver — nur sichere Operationen erlauben' : 'Aggressive erlaubt mehr — nur gefährliche Befehle ablehnen'}
- Workspace-Grenzen — Schreibzugriffe nur innerhalb des Workspaces
- Gefährliche Befehle (rm -rf, sudo, etc.) immer ablehnen
- Read-only Tools (Read, Glob, Grep) sind grundsätzlich sicher

## Aktive Regeln
${rulesSummary || '(keine Regeln konfiguriert)'}

## Inter-Instance Communication
Du kannst direkt mit anderen Instanzen kommunizieren:
- **Sessions**: Du siehst die Aktivität aller überwachten Sessions und kannst ihnen Nachrichten/Guidance senden
- **Ralph Wiggum**: Du siehst aktive Ralph-Runs und kannst Guidance injizieren oder Runs bewerten
- Wenn dir Kontext über Sessions oder Ralph gegeben wird, nutze ihn für fundierte Entscheidungen

## Chat
Beantworte Fragen knapp und hilfreich. Du kannst:
- Goals erstellen/verwalten
- Status berichten
- Sessions überwachen und direkt ansprechen
- Ralph-Runs bewerten und Guidance geben
- Regeln erklären
`;
  }

  private async initCli(): Promise<void> {
    if (this.cliInitialized || !this.processManager) return;

    const cli = this.getCliConfig();
    if (!cli?.enabled) return;

    try {
      const workingDir = cli.workingDirectory || '/mnt/user/appdata/claude-code-webui';

      // Write CLAUDE.md to working directory
      const claudeMdPath = path.join(workingDir, 'WATCHDOG_CLAUDE.md');
      fs.writeFileSync(claudeMdPath, this.generateWatchdogClaudeMd(), 'utf-8');

      // Create a DB session for the watchdog
      const sessionId = randomUUID();
      db.prepare(
        'INSERT INTO sessions (id, user_id, name, working_directory, cli_provider) VALUES (?, ?, ?, ?, ?)'
      ).run(sessionId, 'watchdog-system', 'Watchdog AI', workingDir, cli.cliProvider || 'claude');

      this.cliSessionId = sessionId;

      // Persist the session ID in the CLI config
      if (this.globalConfig.cli) {
        this.globalConfig.cli.sessionId = sessionId;
        this.saveGlobalConfig();
      }

      this.cliInitialized = true;
      console.log('[WATCHDOG] CLI initialized with session:', sessionId);
    } catch (err) {
      console.error('[WATCHDOG] Failed to initialize CLI:', err);
    }
  }

  private async ensureCliSession(): Promise<string | null> {
    if (!this.isCliEnabled()) return null;

    if (!this.cliInitialized) {
      await this.initCli();
    }

    return this.cliSessionId;
  }

  private waitForTurnComplete(sessionId: string, timeoutMs: number): Promise<{
    inputTokens: number;
    outputTokens: number;
    totalCostUsd: number;
  }> {
    return new Promise((resolve, reject) => {
      if (!this.processManager) {
        return reject(new Error('No process manager'));
      }

      const timeout = setTimeout(() => {
        this.processManager!.events.removeListener('turnComplete', handler);
        reject(new Error('Watchdog CLI turn timeout after ' + (timeoutMs / 1000) + 's'));
      }, timeoutMs);

      const handler = (sid: string, data: { inputTokens: number; outputTokens: number; totalCostUsd: number }) => {
        if (sid === sessionId) {
          clearTimeout(timeout);
          this.processManager!.events.removeListener('turnComplete', handler);
          resolve(data);
        }
      };

      this.processManager.events.on('turnComplete', handler);
    });
  }

  private getCollectedResponse(sessionId: string): string {
    const messages = this.responseCollectors.get(sessionId) || [];
    return messages.length > 0 ? (messages[messages.length - 1] ?? '') : '';
  }

  async sendCliMessage(prompt: string): Promise<string> {
    const sessionId = await this.ensureCliSession();
    if (!sessionId || !this.processManager) {
      throw new Error('Watchdog CLI not available');
    }

    const cli = this.getCliConfig();
    const timeoutMs = cli?.permissionTimeoutMs || 30000;

    // Start collecting responses
    this.responseCollectors.set(sessionId, []);

    try {
      await this.processManager.sendMessage(
        sessionId, 'watchdog-system', prompt, undefined, { recordMessage: false }
      );

      await this.waitForTurnComplete(sessionId, timeoutMs);

      const response = this.getCollectedResponse(sessionId);
      this.responseCollectors.delete(sessionId);
      return response;
    } catch (err) {
      this.responseCollectors.delete(sessionId);
      throw err;
    }
  }

  async evaluatePermissionWithCli(request: PendingPermissionRequest): Promise<WatchdogDecision | null> {
    if (!this.isCliEnabled()) return null;
    const cli = this.getCliConfig();
    if (!cli?.useForPermissions) return null;

    const profile = this.getAutonomousProfile(request.sessionId);
    const inputSummary = request.toolInput
      ? JSON.stringify(request.toolInput).substring(0, 500)
      : '(no input)';

    const prompt = `Evaluate this permission request:
Tool: ${request.toolName}
Input: ${inputSummary}
Session: ${request.sessionId}
Profile: ${profile}

Respond with exactly: APPROVE: <reason> or DENY: <reason>`;

    try {
      const response = await this.sendCliMessage(prompt);
      const upperResponse = response.toUpperCase();

      let action: 'approve' | 'deny';
      let reason: string;

      if (upperResponse.includes('APPROVE')) {
        action = 'approve';
        const match = response.match(/APPROVE[:\s]*(.*)/i);
        reason = match?.[1]?.trim() || 'Approved by Watchdog CLI';
      } else if (upperResponse.includes('DENY')) {
        action = 'deny';
        const match = response.match(/DENY[:\s]*(.*)/i);
        reason = match?.[1]?.trim() || 'Denied by Watchdog CLI';
      } else {
        console.log('[WATCHDOG] CLI response did not contain APPROVE or DENY, skipping');
        return null;
      }

      return {
        id: randomUUID(),
        timestamp: Date.now(),
        sessionId: request.sessionId,
        requestId: request.requestId,
        toolName: request.toolName,
        toolInput: request.toolInput,
        action,
        reason: '[CLI] ' + reason,
        automatic: true,
      };
    } catch (err) {
      console.error('[WATCHDOG] CLI permission evaluation failed:', err);
      return null;
    }
  }

  async processChatWithCli(message: string, sessionId?: string, context?: unknown): Promise<{ message: string; goals?: SessionGoal[] }> {
    const monitoredInfo = sessionId
      ? this.monitoredSessions.get(sessionId)
      : null;

    const goals = sessionId ? this.getGoals(sessionId) : [];
    const statusInfo = this.getStatus();
    const crossContext = this.buildCrossInstanceContext();

    const contextParts = [
      `User message: ${message}`,
      sessionId ? `Session: ${sessionId}` : 'No session selected',
      `Watchdog status: ${statusInfo.enabled ? 'Active' : 'Inactive'}, Profile: ${statusInfo.autonomousProfile}`,
      `Monitored sessions: ${statusInfo.monitoredSessions.length}`,
      goals.length > 0 ? `Current goals:\n${goals.map(g => `- [${g.status}] ${g.description}`).join('\n')}` : 'No goals defined',
      monitoredInfo ? `Session state: errors=${monitoredInfo.errorCount}, tokens=${monitoredInfo.tokenUsage}, paused=${monitoredInfo.paused}` : '',
      crossContext ? `\n${crossContext}` : '',
    ].filter(Boolean);

    const prompt = contextParts.join('\n\n');

    try {
      const response = await this.sendCliMessage(prompt);
      return { message: response };
    } catch (err) {
      console.error('[WATCHDOG] CLI chat failed:', err);
      // Fall back to pattern matching
      return this.processChatLocal(message, sessionId, context);
    }
  }

  // CLI config management
  getCliConfig_Public(): WatchdogCliConfig {
    return this.globalConfig.cli || {
      enabled: false,
      cliProvider: 'claude',
      useForPermissions: false,
      useForChat: false,
    };
  }

  setCliConfig(config: WatchdogCliConfig): void {
    this.globalConfig.cli = config;
    this.saveGlobalConfig();

    // Regenerate CLAUDE.md if CLI is initialized
    if (this.cliInitialized && config.workingDirectory) {
      try {
        const claudeMdPath = path.join(config.workingDirectory, 'WATCHDOG_CLAUDE.md');
        fs.writeFileSync(claudeMdPath, this.generateWatchdogClaudeMd(), 'utf-8');
      } catch (err) {
        console.error('[WATCHDOG] Failed to update CLAUDE.md:', err);
      }
    }
  }

  async restartCli(): Promise<void> {
    // Reset CLI state
    this.cliInitialized = false;
    this.cliSessionId = null;
    this.responseCollectors.clear();

    // Re-initialize if enabled
    if (this.isCliEnabled()) {
      await this.initCli();
    }
    console.log('[WATCHDOG] CLI restarted');
  }

  // ===== Active Goal Monitoring =====

  /** Check if a session has active goals with autoMonitor enabled */
  private hasActiveMonitoredGoals(sessionId: string): boolean {
    const ms = this.monitoredSessions.get(sessionId);
    if (!ms) return false;
    return ms.goals.some(g => g.autoMonitor && (g.status === 'in_progress' || g.status === 'pending'));
  }

  /** Schedule goal evaluation with debounce to avoid evaluating during rapid turns */
  private scheduleGoalEvaluation(sessionId: string): void {
    // Clear any existing timer for this session
    const existing = this.pendingEvaluations.get(sessionId);
    if (existing) clearTimeout(existing);

    const delayMs = this.globalConfig.goalMonitoring?.evaluationDelayMs || 3000;
    const timer = setTimeout(() => {
      this.pendingEvaluations.delete(sessionId);
      this.onSessionTurnComplete(sessionId).catch(err => {
        console.error('[WATCHDOG] Goal evaluation error for session ' + sessionId + ':', err);
      });
    }, delayMs);

    this.pendingEvaluations.set(sessionId, timer);
  }

  /** Core monitoring handler — evaluates all active goals for a session */
  private async onSessionTurnComplete(sessionId: string): Promise<void> {
    if (!this.isCliEnabled()) return;
    if (!this.globalConfig.goalMonitoring?.enabled) return;

    const ms = this.monitoredSessions.get(sessionId);
    if (!ms) return;

    const activeGoals = ms.goals.filter(
      g => g.autoMonitor && (g.status === 'in_progress' || g.status === 'pending')
    );

    for (const goal of activeGoals) {
      // Skip if already being evaluated
      if (this.evaluatingGoals.has(goal.id)) continue;

      // Check iteration limit
      const maxIter = goal.maxIterations || this.globalConfig.goalMonitoring?.maxIterationsPerGoal || 20;
      if (goal.iterationCount >= maxIter) {
        this.updateGoal(sessionId, goal.id, {
          status: 'paused',
          notes: `Max iterations reached (${maxIter}). Manual review needed.`,
          autoMonitor: false,
        });
        this.sendTelegramNotification('goalProgress',
          `Goal "${goal.description.substring(0, 50)}" paused: max iterations reached`, sessionId
        );
        continue;
      }

      await this.evaluateGoalProgress(sessionId, goal);
    }
  }

  /** Evaluate a single goal's progress using Watchdog CLI */
  private async evaluateGoalProgress(sessionId: string, goal: SessionGoal): Promise<void> {
    this.evaluatingGoals.add(goal.id);

    try {
      const activity = this.getSessionActivity(sessionId);
      const recentActivity = activity.slice(-20).map(a =>
        `[${a.type}] ${new Date(a.timestamp).toLocaleTimeString()}: ${a.summary}`
      ).join('\n');

      const prompt = `Du bist der Watchdog und überwachst ein Ziel in einer Claude Code Session.

ZIEL: ${goal.description}
ERFOLGSKRITERIEN: ${goal.successCriteria || 'Nicht definiert — nutze dein Urteil'}
CONSTRAINTS: ${goal.constraints || 'Keine'}
ITERATION: ${goal.iterationCount + 1}/${goal.maxIterations || this.globalConfig.goalMonitoring?.maxIterationsPerGoal || 20}
${goal.originalMessage ? `ORIGINAL-WUNSCH: ${goal.originalMessage}` : ''}

LETZTE AKTIVITÄT DER SESSION:
${recentActivity || '(keine Aktivität)'}

Bewerte den Fortschritt und antworte EXAKT in einem der Formate:

COMPLETED: [kurze Begründung warum das Ziel erreicht ist]

CONTINUE: [Präzise Anweisung an die Session was als nächstes zu tun ist]

FAILED: [Begründung warum das Ziel nicht erreichbar ist]

WAITING: [Session arbeitet noch, keine Intervention nötig]`;

      const response = await this.sendCliMessage(prompt);
      if (!response) {
        console.log('[WATCHDOG] No CLI response for goal evaluation');
        return;
      }

      // Update iteration count
      goal.iterationCount++;
      goal.lastEvaluation = response;
      goal.lastEvaluationAt = Date.now();
      goal.updatedAt = Date.now();

      // Parse the response
      const trimmed = response.trim();

      if (trimmed.startsWith('COMPLETED:')) {
        const reason = trimmed.substring('COMPLETED:'.length).trim();
        this.updateGoal(sessionId, goal.id, {
          status: 'completed',
          notes: reason,
          autoMonitor: false,
          progress: 100,
          iterationCount: goal.iterationCount,
          lastEvaluation: response,
          lastEvaluationAt: goal.lastEvaluationAt,
        });
        this.logInterMessage({
          id: randomUUID(),
          timestamp: Date.now(),
          from: 'watchdog',
          to: 'session',
          toSessionId: sessionId,
          content: `Goal completed: ${goal.description.substring(0, 80)}`,
          response: reason,
          type: 'status',
        });
        this.sendTelegramNotification('goalProgress',
          `Goal completed: "${goal.description.substring(0, 50)}": ${reason}`, sessionId
        );
        console.log('[WATCHDOG] Goal completed: ' + goal.description.substring(0, 60));

      } else if (trimmed.startsWith('CONTINUE:')) {
        const instruction = trimmed.substring('CONTINUE:'.length).trim();
        this.updateGoal(sessionId, goal.id, {
          status: 'in_progress',
          iterationCount: goal.iterationCount,
          lastEvaluation: response,
          lastEvaluationAt: goal.lastEvaluationAt,
        });
        // Send follow-up instruction to the session — visible in chat
        await this.sendFollowUp(sessionId, instruction, goal);
        console.log('[WATCHDOG] Follow-up sent for goal: ' + goal.description.substring(0, 60));

      } else if (trimmed.startsWith('FAILED:')) {
        const reason = trimmed.substring('FAILED:'.length).trim();
        this.updateGoal(sessionId, goal.id, {
          status: 'failed',
          notes: reason,
          autoMonitor: false,
          iterationCount: goal.iterationCount,
          lastEvaluation: response,
          lastEvaluationAt: goal.lastEvaluationAt,
        });
        this.sendTelegramNotification('goalProgress',
          `Goal failed: "${goal.description.substring(0, 50)}": ${reason}`, sessionId
        );
        console.log('[WATCHDOG] Goal failed: ' + goal.description.substring(0, 60));

      } else if (trimmed.startsWith('WAITING:')) {
        // Session is still working, no intervention needed
        this.updateGoal(sessionId, goal.id, {
          iterationCount: goal.iterationCount,
          lastEvaluation: response,
          lastEvaluationAt: goal.lastEvaluationAt,
        });
        console.log('[WATCHDOG] Goal waiting: ' + goal.description.substring(0, 60));

      } else {
        // Unparseable response — log but don't act
        console.warn('[WATCHDOG] Unparseable goal evaluation response: ' + trimmed.substring(0, 100));
        this.updateGoal(sessionId, goal.id, {
          iterationCount: goal.iterationCount,
          lastEvaluation: response,
          lastEvaluationAt: goal.lastEvaluationAt,
        });
      }

      this.saveMonitoredSessions();

    } finally {
      this.evaluatingGoals.delete(goal.id);
    }
  }

  /** Send a visible follow-up instruction to a session (recordMessage: true) */
  private async sendFollowUp(sessionId: string, instruction: string, goal: SessionGoal): Promise<void> {
    if (!this.processManager) return;

    const prefixedMessage = `[Watchdog] ${instruction}`;

    const interMsg: WatchdogInterMessage = {
      id: randomUUID(),
      timestamp: Date.now(),
      from: 'watchdog',
      to: 'session',
      toSessionId: sessionId,
      content: prefixedMessage,
      type: 'guidance',
    };

    this.responseCollectors.set(sessionId, []);

    try {
      // Send with recordMessage: true so it appears in the session chat
      await this.processManager.sendMessage(
        sessionId, 'watchdog-system', prefixedMessage, undefined, { recordMessage: true }
      );

      // Wait for the session to process and respond
      const response = await this.waitForTurnComplete(sessionId, 120000)
        .then(() => this.getCollectedResponse(sessionId))
        .catch(() => null);

      this.responseCollectors.delete(sessionId);
      interMsg.response = response?.substring(0, 500) || undefined;
      this.logInterMessage(interMsg);
      this.recordSessionActivity(sessionId, 'message',
        `[Watchdog follow-up for "${goal.description.substring(0, 40)}"] ${instruction.substring(0, 100)}`
      );

    } catch (err) {
      this.responseCollectors.delete(sessionId);
      console.error('[WATCHDOG] sendFollowUp failed:', err);
      interMsg.response = 'Error: ' + (err instanceof Error ? err.message : String(err));
      this.logInterMessage(interMsg);
    }
  }

  /** Detect if a user message in a monitored session is a goal/wish */
  private async detectGoalFromMessage(sessionId: string, message: string): Promise<void> {
    if (!this.isCliEnabled()) return;

    const prompt = `Ist die folgende Nachricht eines Users in einer Claude Code Session ein Auftrag/Wunsch/Ziel?
Nachricht: "${message.substring(0, 500)}"

Antworte EXAKT in einem der Formate:

GOAL: [Kurze Beschreibung des Ziels] | CRITERIA: [Erfolgskriterien]

NO_GOAL: [Begründung — z.B. eine Frage, Bestätigung, oder kurze Antwort]`;

    try {
      const response = await this.sendCliMessage(prompt);
      if (!response || !response.trim().startsWith('GOAL:')) return;

      const goalPart = response.trim().substring('GOAL:'.length);
      const parts = goalPart.split('| CRITERIA:');
      const description = parts[0]?.trim();
      const criteria = parts[1]?.trim();

      if (!description || description.length < 5) return;

      console.log('[WATCHDOG] Auto-detected goal from session ' + sessionId + ': ' + description.substring(0, 60));

      this.addGoal(sessionId, {
        description,
        successCriteria: criteria || undefined,
        priority: 'medium',
        status: 'in_progress',
        autoMonitor: true,
        iterationCount: 0,
        originalMessage: message.substring(0, 500),
      });

      this.logInterMessage({
        id: randomUUID(),
        timestamp: Date.now(),
        from: 'watchdog',
        to: 'session',
        toSessionId: sessionId,
        content: `Auto-detected goal: ${description}`,
        type: 'status',
      });

    } catch (err) {
      console.error('[WATCHDOG] detectGoalFromMessage failed:', err);
    }
  }

  /** Start active monitoring for a specific goal — optionally send initial instruction */
  async startGoalMonitoring(sessionId: string, goalId: string, instruction?: string): Promise<boolean> {
    const goal = this.monitoredSessions.get(sessionId)?.goals.find(g => g.id === goalId);
    if (!goal) return false;

    goal.autoMonitor = true;
    goal.status = goal.status === 'pending' ? 'in_progress' : goal.status;
    goal.updatedAt = Date.now();
    this.saveMonitoredSessions();

    // If there's an initial instruction, send it to the session
    if (instruction) {
      await this.sendFollowUp(sessionId, instruction, goal);
    }

    console.log('[WATCHDOG] Started monitoring goal: ' + goal.description.substring(0, 60));
    return true;
  }

  /** Stop active monitoring for a specific goal */
  stopGoalMonitoring(sessionId: string, goalId: string): boolean {
    const goal = this.monitoredSessions.get(sessionId)?.goals.find(g => g.id === goalId);
    if (!goal) return false;

    goal.autoMonitor = false;
    goal.updatedAt = Date.now();
    this.saveMonitoredSessions();

    console.log('[WATCHDOG] Stopped monitoring goal: ' + goal.description.substring(0, 60));
    return true;
  }

  /** Send instruction to a session and create a monitored goal for it */
  async instructSession(sessionId: string, message: string, createGoal = true): Promise<{ goalId?: string; response?: string }> {
    // Ensure session is monitored
    if (!this.monitoredSessions.has(sessionId)) {
      this.setSessionMonitored(sessionId, true);
    }

    // Resolve the session owner's userId so we pass auth checks in processManager
    let sessionUserId = 'watchdog-system';
    try {
      const row = db.prepare('SELECT user_id FROM sessions WHERE id = ?').get(sessionId) as { user_id: string } | undefined;
      if (row?.user_id) sessionUserId = row.user_id;
    } catch { /* fallback */ }

    let goalId: string | undefined;

    if (createGoal) {
      const goal = this.addGoal(sessionId, {
        description: message.substring(0, 200),
        priority: 'medium',
        status: 'in_progress',
        autoMonitor: true,
        iterationCount: 0,
        originalMessage: message,
      });
      goalId = goal.id;
    }

    // Send the instruction to the session (visible in chat)
    const prefixedMessage = `[Watchdog] ${message}`;

    this.responseCollectors.set(sessionId, []);

    try {
      await this.processManager!.sendMessage(
        sessionId, sessionUserId, prefixedMessage, undefined, { recordMessage: true }
      );

      const response = await this.waitForTurnComplete(sessionId, 120000)
        .then(() => this.getCollectedResponse(sessionId))
        .catch(() => null);

      this.responseCollectors.delete(sessionId);

      this.logInterMessage({
        id: randomUUID(),
        timestamp: Date.now(),
        from: 'watchdog',
        to: 'session',
        toSessionId: sessionId,
        content: message,
        response: response?.substring(0, 500) || undefined,
        type: 'guidance',
      });

      return { goalId, response: response || undefined };
    } catch (err) {
      this.responseCollectors.delete(sessionId);
      console.error('[WATCHDOG] instructSession failed:', err);
      return { goalId };
    }
  }

  // ===== Inter-Instance Communication =====

  private logInterMessage(msg: WatchdogInterMessage): void {
    this.interMessages.push(msg);
    if (this.interMessages.length > WatchdogService.MAX_INTER_MESSAGES) {
      this.interMessages.splice(0, this.interMessages.length - WatchdogService.MAX_INTER_MESSAGES);
    }
    // Broadcast to all connected clients
    this.io.emit('watchdog:inter_message', msg);
  }

  /**
   * Send a message from the Watchdog directly into an active session's CLI.
   * The session will process it as a user message and respond.
   */
  async sendToSession(targetSessionId: string, message: string): Promise<string | null> {
    if (!this.processManager) return null;

    const interMsg: WatchdogInterMessage = {
      id: randomUUID(),
      timestamp: Date.now(),
      from: 'watchdog',
      fromSessionId: this.cliSessionId || undefined,
      to: 'session',
      toSessionId: targetSessionId,
      content: message,
      type: 'guidance',
    };

    // Set up response collector for the target session
    this.responseCollectors.set(targetSessionId, []);

    try {
      await this.processManager.sendMessage(
        targetSessionId, 'watchdog-system', message, undefined, { recordMessage: false }
      );

      // Wait for response
      const response = await this.waitForTurnComplete(targetSessionId, 60000)
        .then(() => this.getCollectedResponse(targetSessionId))
        .catch(() => null);

      this.responseCollectors.delete(targetSessionId);

      interMsg.response = response || undefined;
      this.logInterMessage(interMsg);
      this.recordSessionActivity(targetSessionId, 'message', '[Watchdog guidance] ' + message.substring(0, 100));

      console.log('[WATCHDOG] Sent to session ' + targetSessionId + ': ' + message.substring(0, 80));
      return response;
    } catch (err) {
      this.responseCollectors.delete(targetSessionId);
      console.error('[WATCHDOG] sendToSession failed:', err);
      interMsg.response = 'Error: ' + (err instanceof Error ? err.message : String(err));
      this.logInterMessage(interMsg);
      return null;
    }
  }

  /**
   * Send guidance into a Ralph run's session.
   */
  async sendGuidanceToRalph(runId: string, message: string): Promise<string | null> {
    let ralph;
    try {
      const mod = await import('../ralph/RalphService');
      ralph = mod.getRalph();
    } catch {
      return null;
    }
    if (!ralph) return null;

    const run = ralph.getRunState(runId);
    if (!run) return null;

    const interMsg: WatchdogInterMessage = {
      id: randomUUID(),
      timestamp: Date.now(),
      from: 'watchdog',
      fromSessionId: this.cliSessionId || undefined,
      to: 'ralph',
      toSessionId: run.sessionId,
      toRunId: runId,
      content: message,
      type: 'guidance',
    };

    // Send to Ralph's session
    const response = await this.sendToSession(run.sessionId,
      `[Watchdog Guidance for Ralph Run "${run.idea?.substring(0, 50)}"]\n\n${message}`
    );

    interMsg.response = response || undefined;
    this.logInterMessage(interMsg);

    console.log('[WATCHDOG] Sent guidance to Ralph run ' + runId);
    return response;
  }

  /**
   * A session or Ralph consults the Watchdog's CLI for advice.
   * Includes context about the requesting session.
   */
  async consultWatchdog(fromSessionId: string, question: string, fromSource: 'session' | 'ralph' = 'session'): Promise<string | null> {
    if (!this.isCliEnabled()) return null;

    const activity = this.getSessionActivity(fromSessionId);
    const goals = this.getGoals(fromSessionId);
    const monitoredState = this.monitoredSessions.get(fromSessionId);

    const contextParts = [
      `A ${fromSource} is consulting you:`,
      `Session: ${fromSessionId}`,
      `Question: ${question}`,
      monitoredState ? `Session state: errors=${monitoredState.errorCount}, tokens=${monitoredState.tokenUsage}, paused=${monitoredState.paused}` : '',
      goals.length > 0 ? `Goals:\n${goals.map(g => `- [${g.status}] ${g.description}`).join('\n')}` : '',
      activity.length > 0 ? `Recent activity:\n${activity.slice(-10).map(a => `[${a.type}] ${a.summary}`).join('\n')}` : '',
    ].filter(Boolean);

    const prompt = contextParts.join('\n\n');

    const interMsg: WatchdogInterMessage = {
      id: randomUUID(),
      timestamp: Date.now(),
      from: fromSource,
      fromSessionId,
      to: 'watchdog',
      content: question,
      type: 'query',
    };

    try {
      const response = await this.sendCliMessage(prompt);
      interMsg.response = response;
      this.logInterMessage(interMsg);
      return response;
    } catch (err) {
      console.error('[WATCHDOG] consultWatchdog failed:', err);
      interMsg.response = 'Error: ' + (err instanceof Error ? err.message : String(err));
      this.logInterMessage(interMsg);
      return null;
    }
  }

  /**
   * Get the Watchdog's AI assessment of a session, using its CLI.
   * Builds rich context from activity, goals, and Ralph state.
   */
  async assessSession(sessionId: string): Promise<string | null> {
    if (!this.isCliEnabled()) return null;

    const activity = this.getSessionActivity(sessionId);
    const goals = this.getGoals(sessionId);
    const monitoredState = this.monitoredSessions.get(sessionId);

    // Check if there's an active Ralph run for this session
    let ralphInfo = '';
    try {
      const { getRalph } = await import('../ralph/RalphService');
      const ralph = getRalph();
      if (ralph) {
        const run = ralph.getRunBySession(sessionId);
        if (run) {
          ralphInfo = `\nRalph run active: "${run.idea?.substring(0, 80)}" — Status: ${run.status}, Progress: ${run.progress.completedTasks}/${run.progress.totalTasks} tasks`;
        }
      }
    } catch { /* no Ralph */ }

    const prompt = `Provide a brief assessment of this session:
Session: ${sessionId}
State: errors=${monitoredState?.errorCount || 0}, tokens=${monitoredState?.tokenUsage || 0}, paused=${monitoredState?.paused || false}
${goals.length > 0 ? `Goals:\n${goals.map(g => `- [${g.status}] ${g.description}`).join('\n')}` : 'No goals defined'}
${ralphInfo}
${activity.length > 0 ? `Recent activity (last ${Math.min(activity.length, 15)}):\n${activity.slice(-15).map(a => `[${a.type}] ${a.summary}`).join('\n')}` : 'No recent activity'}

Assess: Is the session on track? Any risks? Recommendations?`;

    try {
      return await this.sendCliMessage(prompt);
    } catch (err) {
      console.error('[WATCHDOG] assessSession failed:', err);
      return null;
    }
  }

  // Activity + inter-message getters

  getSessionActivity(sessionId: string): SessionActivityEntry[] {
    return this.sessionActivity.get(sessionId) || [];
  }

  getAllActivity(): SessionActivityEntry[] {
    const all: SessionActivityEntry[] = [];
    for (const entries of this.sessionActivity.values()) {
      all.push(...entries);
    }
    return all.sort((a, b) => b.timestamp - a.timestamp).slice(0, 100);
  }

  getInterMessages(limit = 50): WatchdogInterMessage[] {
    return this.interMessages.slice(-limit);
  }

  /**
   * Build a context string about all active sessions/Ralph for the Watchdog's CLI.
   */
  private buildCrossInstanceContext(): string {
    const parts: string[] = [];

    // Monitored sessions summary
    const monitored = this.getMonitoredSessions();
    if (monitored.length > 0) {
      parts.push('=== Monitored Sessions ===');
      for (const ms of monitored) {
        const activity = this.getSessionActivity(ms.sessionId);
        const lastMsg = activity.length > 0 ? activity[activity.length - 1]!.summary.substring(0, 100) : 'no activity';
        parts.push(`- ${ms.sessionId.substring(0, 8)}... errors=${ms.errorCount} tokens=${ms.tokenUsage} paused=${ms.paused} goals=${ms.goals.length} last: ${lastMsg}`);
      }
    }

    // Ralph runs
    try {
      // Dynamic import to avoid circular dependency
      const ralphMod = require('../ralph/RalphService');
      const ralph = ralphMod.getRalph?.();
      if (ralph) {
        const runs = ralph.getAllRuns?.() || [];
        const activeRuns = runs.filter((r: { status: string }) => r.status === 'planning' || r.status === 'executing' || r.status === 'paused');
        if (activeRuns.length > 0) {
          parts.push('\n=== Active Ralph Runs ===');
          for (const run of activeRuns) {
            parts.push(`- Run ${run.id.substring(0, 8)}: "${run.idea?.substring(0, 60)}" status=${run.status} progress=${run.progress?.completedTasks}/${run.progress?.totalTasks}`);
          }
        }
      }
    } catch { /* no Ralph */ }

    // Recent inter-messages
    const recent = this.interMessages.slice(-5);
    if (recent.length > 0) {
      parts.push('\n=== Recent Cross-Instance Messages ===');
      for (const msg of recent) {
        parts.push(`- [${msg.from}->${msg.to}] ${msg.content.substring(0, 80)}`);
      }
    }

    return parts.join('\n');
  }

  // ===== Chat =====

  processChat(message: string, sessionId?: string, context?: unknown): { message: string; goals?: SessionGoal[] } | Promise<{ message: string; goals?: SessionGoal[] }> {
    const cli = this.getCliConfig();
    if (cli?.enabled && cli.useForChat && this.processManager) {
      // Check for simple fast-path commands first
      const lower = message.toLowerCase();
      const isSimpleCommand =
        (lower.includes('goal') && (lower.includes('add') || lower.includes('create') || lower.includes('neue'))) ||
        lower.includes('status') ||
        lower === 'help';

      if (!isSimpleCommand) {
        return this.processChatWithCli(message, sessionId, context);
      }
    }
    return this.processChatLocal(message, sessionId, context);
  }

  private processChatLocal(message: string, sessionId?: string, _context?: unknown): { message: string; goals?: SessionGoal[] } {
    const lower = message.toLowerCase();

    // Simple intent detection for goal creation
    if (lower.includes('goal') || lower.includes('ziel') || lower.includes('aufgabe') || lower.includes('task')) {
      if (lower.includes('add') || lower.includes('create') || lower.includes('neue') || lower.includes('erstell')) {
        if (sessionId) {
          // Extract goal description - everything after the keyword
          const desc = message.replace(/^.*?(goal|ziel|aufgabe|task)[:\s]*/i, '').trim();
          if (desc.length > 3) {
            const goal = this.addGoal(sessionId, {
              description: desc,
              priority: 'medium',
              status: 'pending',
            });
            return {
              message: 'Goal created: "' + desc + '"\n\nI will monitor this session and track progress toward this goal.',
              goals: [goal],
            };
          }
        }
        return {
          message: sessionId
            ? 'What goal should I add? Describe what you want to achieve in this session.'
            : 'Please select a session first, then describe the goal you want to add.',
        };
      }
    }

    // List goals
    if (lower.includes('list') || lower.includes('show') || lower.includes('zeig')) {
      if (sessionId) {
        const goals = this.getGoals(sessionId);
        if (goals.length === 0) {
          return { message: 'No goals defined for this session yet. Tell me what you want to achieve!' };
        }
        const list = goals.map((g, i) => (i + 1) + '. [' + g.status + '] ' + g.description).join('\n');
        return { message: 'Goals for this session:\n\n' + list };
      }
      return { message: 'Select a session to see its goals.' };
    }

    // Monitor session
    if (lower.includes('monitor') || lower.includes('watch') || lower.includes('überwach')) {
      if (sessionId) {
        this.setSessionMonitored(sessionId, true);
        return { message: 'Session is now being monitored. I will track activity and handle permissions according to the configured rules.' };
      }
      return { message: 'Select a session to start monitoring.' };
    }

    // Autonomous profile
    if (lower.includes('profile') || lower.includes('modus') || lower.includes('mode')) {
      if (lower.includes('aggressive')) {
        this.setAutonomousProfile('aggressive', sessionId);
        return { message: sessionId ? 'Session profile set to aggressive.' : 'Global profile set to aggressive.' };
      }
      if (lower.includes('balanced')) {
        this.setAutonomousProfile('balanced', sessionId);
        return { message: sessionId ? 'Session profile set to balanced.' : 'Global profile set to balanced.' };
      }
    }

    // Status
    if (lower.includes('status') || lower.includes('wie') || lower.includes('how')) {
      const status = this.getStatus();
      const monitored = this.getMonitoredSessions();
      let msg = 'Watchdog Status: ' + (status.enabled ? 'Active' : 'Inactive') + '\n';
      msg += 'Autonomous profile: ' + (sessionId ? this.getAutonomousProfile(sessionId) : this.sanitizeAutonomousProfile(this.globalConfig.autonomousProfile)) + '\n';
      msg += 'Monitored sessions: ' + monitored.length + '\n';
      msg += 'Active rules: ' + status.activeRules + '\n';
      msg += 'Decisions today: ' + status.decisionsToday + '\n';
      msg += 'Telegram: ' + (this.isTelegramConnected() ? 'Connected' : 'Not configured');
      if (sessionId) {
        const goals = this.getGoals(sessionId);
        msg += '\n\nThis session has ' + goals.length + ' goal(s).';
      }
      return { message: msg };
    }

    // Help / default
    return {
      message: 'I can help you with:\n\n' +
        '• **Add a goal** - Define what a session should achieve\n' +
        '• **Show goals** - List current goals for a session\n' +
        '• **Monitor** - Start monitoring a session\n' +
        '• **Profile balanced/aggressive** - Tune autonomy strictness\n' +
        '• **Status** - Show watchdog status\n\n' +
        'Select a session on the left, then tell me what you want to accomplish. ' +
        'I will monitor the session, handle permissions, and notify you on Telegram if configured.',
    };
  }

  // ===== Permission Evaluation =====

  async evaluatePermission(request: PendingPermissionRequest): Promise<WatchdogDecision | null> {
    const config = this.getEffectiveConfig(request.sessionId);
    if (!config.enabled) return null;
    this.initSession(request.sessionId);

    const stats = this.getOrCreateSessionStats(request.sessionId);

    if (config.maxRuntimeMinutes) {
      const elapsedMinutes = (Date.now() - stats.startTime) / (60 * 1000);
      if (elapsedMinutes >= config.maxRuntimeMinutes) {
        this.pauseSession(request.sessionId, 'Runtime limit exceeded');
        const decision: WatchdogDecision = {
          id: randomUUID(),
          timestamp: Date.now(),
          sessionId: request.sessionId,
          requestId: request.requestId,
          toolName: request.toolName,
          toolInput: request.toolInput,
          action: 'deny',
          reason: 'Session runtime limit exceeded',
          automatic: true,
        };
        this.logDecision(decision);
        return decision;
      }
    }

    if (this.normalizeToolName(request.toolName) === 'bash') {
      const command = this.getInputString(request.toolInput, 'command');
      if (command && this.isDangerousBashCommand(command)) {
        const decision: WatchdogDecision = {
          id: randomUUID(),
          timestamp: Date.now(),
          sessionId: request.sessionId,
          requestId: request.requestId,
          toolName: request.toolName,
          toolInput: request.toolInput,
          action: 'deny',
          reason: `Dangerous command blocked by watchdog: ${command.substring(0, 140)}`,
          automatic: true,
        };
        this.logDecision(decision);
        this.sendTelegramNotification('deny', `${request.toolName} denied: dangerous command`, request.sessionId);
        return decision;
      }
      if (command && this.hasMutatingExternalPath(request.sessionId, command)) {
        const decision: WatchdogDecision = {
          id: randomUUID(),
          timestamp: Date.now(),
          sessionId: request.sessionId,
          requestId: request.requestId,
          toolName: request.toolName,
          toolInput: request.toolInput,
          action: 'deny',
          reason: 'Mutating shell command targets path outside session workspace',
          automatic: true,
        };
        this.logDecision(decision);
        this.sendTelegramNotification('deny', `${request.toolName} denied: outside workspace`, request.sessionId);
        return decision;
      }
    }

    if (this.isSessionPaused(request.sessionId)) {
      const decision: WatchdogDecision = {
        id: randomUUID(),
        timestamp: Date.now(),
        sessionId: request.sessionId,
        requestId: request.requestId,
        toolName: request.toolName,
        toolInput: request.toolInput,
        action: 'deny',
        reason: 'Session is paused by watchdog',
        automatic: true,
      };
      this.logDecision(decision);
      return decision;
    }

    const sortedRules = [...config.rules].filter(r => r.enabled).sort((a, b) => a.priority - b.priority);

    for (const rule of sortedRules) {
      if (this.matchesCondition(rule.condition, request, stats)) {
        const decision: WatchdogDecision = {
          id: randomUUID(),
          timestamp: Date.now(),
          sessionId: request.sessionId,
          requestId: request.requestId,
          toolName: request.toolName,
          toolInput: request.toolInput,
          rule,
          action: rule.action.type,
          reason: this.getActionReason(rule),
          automatic: true,
        };
        this.logDecision(decision);

        if (rule.action.type === 'pause') {
          this.pauseSession(request.sessionId, rule.action.reason || 'Paused by watchdog rule');
        } else if (rule.action.type === 'notify') {
          const webhookUrl = rule.action.webhook || config.notifyWebhook;
          if (webhookUrl) {
            this.sendWebhookNotification(webhookUrl, {
              type: 'permission_notification',
              sessionId: request.sessionId,
              toolName: request.toolName,
              timestamp: Date.now(),
            });
          }
          this.sendTelegramNotification('notify', 'Tool ' + request.toolName + ' requested', request.sessionId);
          continue;
        }

        // Telegram for approve/deny
        if (rule.action.type === 'approve') {
          this.sendTelegramNotification('approve', request.toolName + ' auto-approved', request.sessionId);
        } else if (rule.action.type === 'deny') {
          this.sendTelegramNotification('deny', request.toolName + ' denied: ' + (rule.action.reason || rule.name), request.sessionId);
        }

        return decision;
      }
    }

    const fallbackDecision = this.buildAutonomousFallbackDecision(request);
    if (fallbackDecision) {
      this.logDecision(fallbackDecision);
      if (fallbackDecision.action === 'approve') {
        this.sendTelegramNotification('approve', request.toolName + ' auto-approved', request.sessionId);
      } else if (fallbackDecision.action === 'deny') {
        this.sendTelegramNotification('deny', request.toolName + ' denied: ' + fallbackDecision.reason, request.sessionId);
      }
      return fallbackDecision;
    }

    // CLI fallback for undecided permissions
    if (this.isCliEnabled() && this.getCliConfig()?.useForPermissions) {
      const cliDecision = await this.evaluatePermissionWithCli(request);
      if (cliDecision) {
        this.logDecision(cliDecision);
        if (cliDecision.action === 'approve') {
          this.sendTelegramNotification('approve', request.toolName + ' approved by CLI', request.sessionId);
        } else if (cliDecision.action === 'deny') {
          this.sendTelegramNotification('deny', request.toolName + ' denied by CLI: ' + cliDecision.reason, request.sessionId);
        }
        return cliDecision;
      }
    }

    return null;
  }

  private matchesCondition(condition: WatchdogCondition, request: PendingPermissionRequest, stats: SessionStats): boolean {
    switch (condition.type) {
      case 'tool_match': {
        if (condition.toolName !== request.toolName) return false;
        if (condition.pattern) return this.matchPattern(condition.pattern, request.toolInput);
        return true;
      }
      case 'tool_any': return true;
      case 'error_count': {
        const windowStart = Date.now() - condition.windowMinutes * 60 * 1000;
        return stats.errorCount >= condition.threshold && stats.lastErrorTime >= windowStart;
      }
      case 'token_usage': return stats.tokenUsage >= condition.threshold;
      case 'time_elapsed': {
        const elapsed = (Date.now() - stats.startTime) / (60 * 1000);
        return elapsed >= condition.minutes;
      }
      case 'always': return true;
      default: return false;
    }
  }

  private matchPattern(pattern: string, toolInput: unknown): boolean {
    if (!toolInput || typeof toolInput !== 'object') return false;
    const input = toolInput as Record<string, unknown>;
    let valueToMatch = '';
    if ('command' in input && typeof input.command === 'string') valueToMatch = input.command;
    else if ('file_path' in input && typeof input.file_path === 'string') valueToMatch = input.file_path;
    else if ('pattern' in input && typeof input.pattern === 'string') valueToMatch = input.pattern;
    else if ('url' in input && typeof input.url === 'string') valueToMatch = input.url;
    if (pattern.endsWith(':*')) {
      const prefix = pattern.slice(0, -2);
      return valueToMatch.startsWith(prefix);
    }
    return valueToMatch === pattern;
  }

  private getActionReason(rule: WatchdogRule): string {
    switch (rule.action.type) {
      case 'approve': return 'Auto-approved by rule: ' + rule.name;
      case 'deny': return rule.action.reason || 'Denied by rule: ' + rule.name;
      case 'pause': return rule.action.reason || 'Session paused by rule: ' + rule.name;
      case 'notify': return 'Notification triggered by rule: ' + rule.name;
      default: return 'Action by rule: ' + rule.name;
    }
  }

  private logDecision(decision: WatchdogDecision): void {
    this.decisions.push(decision);
    if (this.decisions.length > 1000) {
      this.decisions = this.decisions.slice(-1000);
    }
    const config = this.getEffectiveConfig(decision.sessionId);
    if (config.logDecisions) {
      console.log('[WATCHDOG] Decision: ' + decision.action + ' for ' + decision.toolName + ' in session ' + decision.sessionId + ' - ' + decision.reason);
    }
    this.io.to('session:' + decision.sessionId).emit('session:watchdog_decision', decision);
  }

  private cleanupOldDecisions(): void {
    const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
    this.decisions = this.decisions.filter(d => d.timestamp >= oneDayAgo);
  }

  private async sendWebhookNotification(url: string, payload: unknown): Promise<void> {
    try {
      await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
    } catch (err) {
      console.error('[WATCHDOG] Webhook notification failed:', err);
    }
  }

  // ===== API Methods =====

  getGlobalConfig(): WatchdogConfig {
    return this.globalConfig;
  }

  setGlobalConfig(config: WatchdogConfig): void {
    this.globalConfig = this.normalizeConfig(config);
    this.saveGlobalConfig();
  }

  getSessionConfig(sessionId: string): WatchdogConfig | null {
    return this.sessionConfigs.get(sessionId) || null;
  }

  setSessionConfig(sessionId: string, config: WatchdogConfig | null): void {
    if (config) {
      this.sessionConfigs.set(sessionId, this.normalizeConfig(config));
    } else {
      this.sessionConfigs.delete(sessionId);
    }
    this.saveSessionConfig(sessionId);
  }

  getStatus(): WatchdogStatus {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayStart = today.getTime();
    const decisionsToday = this.decisions.filter(d => d.timestamp >= todayStart).length;
    const lastDecision = this.decisions[this.decisions.length - 1];
    return {
      enabled: this.globalConfig.enabled,
      autonomousProfile: this.sanitizeAutonomousProfile(this.globalConfig.autonomousProfile),
      activeRules: this.globalConfig.rules.filter(r => r.enabled).length,
      decisionsToday,
      lastDecision,
      pausedSessions: Array.from(this.pausedSessions),
      monitoredSessions: this.getMonitoredSessions(),
      telegramConnected: this.isTelegramConnected(),
    };
  }

  getDecisions(sessionId?: string, limit = 100): WatchdogDecision[] {
    let filtered = this.decisions;
    if (sessionId) {
      filtered = filtered.filter(d => d.sessionId === sessionId);
    }
    return filtered.slice(-limit);
  }

  setAutonomousProfile(profile: WatchdogAutonomousProfile, sessionId?: string): void {
    const normalizedProfile = this.sanitizeAutonomousProfile(profile);
    if (sessionId) {
      const config = this.sessionConfigs.get(sessionId) || {
        ...this.globalConfig,
        sessionId,
      };
      config.autonomousProfile = normalizedProfile;
      this.setSessionConfig(sessionId, config);
      return;
    }
    this.globalConfig.autonomousProfile = normalizedProfile;
    this.saveGlobalConfig();
  }

  getAudit(sessionId?: string, limit = 200): WatchdogAuditSummary {
    const recent = this.getDecisions(sessionId, limit);
    const automatic = recent.filter((d) => d.automatic);
    const actions: Record<'approve' | 'deny' | 'pause' | 'notify', number> = {
      approve: 0,
      deny: 0,
      pause: 0,
      notify: 0,
    };
    const reasonCounter = new Map<string, number>();
    for (const decision of automatic) {
      actions[decision.action] += 1;
      reasonCounter.set(decision.reason, (reasonCounter.get(decision.reason) || 0) + 1);
    }
    const topReasons = Array.from(reasonCounter.entries())
      .map(([reason, count]) => ({ reason, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);
    let profile: WatchdogAutonomousProfile | 'mixed';
    if (sessionId) {
      profile = this.getAutonomousProfile(sessionId);
    } else {
      const profiles = new Set<WatchdogAutonomousProfile>();
      profiles.add(this.sanitizeAutonomousProfile(this.globalConfig.autonomousProfile));
      for (const config of this.sessionConfigs.values()) {
        profiles.add(this.sanitizeAutonomousProfile(config.autonomousProfile));
      }
      profile = profiles.size === 1 ? Array.from(profiles)[0]! : 'mixed';
    }
    return {
      sessionId,
      profile,
      decisionsConsidered: recent.length,
      automaticDecisions: automatic.length,
      manualDecisions: recent.length - automatic.length,
      actions,
      topReasons,
      recentAutomaticDecisions: automatic.slice(-25),
    };
  }

  addRule(rule: WatchdogRule, sessionId?: string): void {
    const config = sessionId
      ? this.sessionConfigs.get(sessionId) || { ...this.globalConfig, sessionId }
      : this.globalConfig;
    const existingIndex = config.rules.findIndex(r => r.id === rule.id);
    if (existingIndex >= 0) {
      config.rules[existingIndex] = rule;
    } else {
      config.rules.push(rule);
    }
    if (sessionId) {
      this.setSessionConfig(sessionId, config);
    } else {
      this.saveGlobalConfig();
    }
  }

  removeRule(ruleId: string, sessionId?: string): void {
    const config = sessionId ? this.sessionConfigs.get(sessionId) : this.globalConfig;
    if (config) {
      config.rules = config.rules.filter(r => r.id !== ruleId);
      if (sessionId) {
        this.setSessionConfig(sessionId, config);
      } else {
        this.saveGlobalConfig();
      }
    }
  }

  toggleRule(ruleId: string, enabled: boolean, sessionId?: string): void {
    const config = sessionId ? this.sessionConfigs.get(sessionId) : this.globalConfig;
    if (config) {
      const rule = config.rules.find(r => r.id === ruleId);
      if (rule) {
        rule.enabled = enabled;
        if (sessionId) {
          this.setSessionConfig(sessionId, config);
        } else {
          this.saveGlobalConfig();
        }
      }
    }
  }
}

// Singleton
let watchdogInstance: WatchdogService | null = null;

export function initWatchdog(io: SocketServer, processManager?: ClaudeProcessManager): WatchdogService {
  if (!watchdogInstance) {
    watchdogInstance = new WatchdogService(io, processManager);
  }
  return watchdogInstance;
}

export function getWatchdog(): WatchdogService | null {
  return watchdogInstance;
}
