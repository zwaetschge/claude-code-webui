import { spawn } from 'child_process';
import type { WatchdogService } from './WatchdogService';

// ===== Telegram API Types =====

interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  callback_query?: TelegramCallbackQuery;
}

interface TelegramMessage {
  message_id: number;
  from?: { id: number; first_name: string };
  chat: { id: number; type: string };
  text?: string;
  date: number;
}

interface TelegramCallbackQuery {
  id: string;
  from: { id: number; first_name: string };
  message?: TelegramMessage;
  data?: string;
}

interface TelegramInlineKeyboardButton {
  text: string;
  callback_data?: string;
}

interface TelegramInlineKeyboard {
  inline_keyboard: TelegramInlineKeyboardButton[][];
}

// ===== TelegramBotService =====

export class TelegramBotService {
  private watchdog: WatchdogService;
  private botToken: string = '';
  private chatId: string = '';
  private offset: number = 0;
  private pollingActive: boolean = false;
  private pollingTimer: NodeJS.Timeout | null = null;
  private pendingInstructions: Map<string, string> = new Map(); // chatId -> sessionId
  private chatHistory: Array<{ role: 'user' | 'assistant'; text: string }> = [];
  private readonly MAX_HISTORY = 12;

  constructor(watchdog: WatchdogService) {
    this.watchdog = watchdog;
  }

  start(botToken: string, chatId: string): void {
    if (this.pollingActive) return;
    this.botToken = botToken;
    this.chatId = chatId;
    this.pollingActive = true;
    this.offset = 0;
    console.log('[TELEGRAM BOT] Polling started');
    this.pollUpdates();
  }

  stop(): void {
    this.pollingActive = false;
    if (this.pollingTimer) {
      clearTimeout(this.pollingTimer);
      this.pollingTimer = null;
    }
    console.log('[TELEGRAM BOT] Polling stopped');
  }

  isRunning(): boolean {
    return this.pollingActive;
  }

  // ===== Polling Loop =====

  private async pollUpdates(): Promise<void> {
    if (!this.pollingActive) return;

    try {
      const url = `https://api.telegram.org/bot${this.botToken}/getUpdates?offset=${this.offset}&timeout=30`;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 35000);

      const resp = await fetch(url, { signal: controller.signal });
      clearTimeout(timeout);

      const data = await resp.json() as { ok: boolean; result?: TelegramUpdate[] };
      if (data.ok && data.result) {
        for (const update of data.result) {
          this.offset = update.update_id + 1;
          this.processUpdate(update).catch(err => {
            console.error('[TELEGRAM BOT] Error processing update:', err);
          });
        }
      }
    } catch (err) {
      if (this.pollingActive) {
        const msg = err instanceof Error ? err.name : String(err);
        if (msg !== 'AbortError') {
          console.error('[TELEGRAM BOT] Poll error:', msg);
        }
      }
    }

    // Schedule next poll
    if (this.pollingActive) {
      this.pollingTimer = setTimeout(() => this.pollUpdates(), 500);
    }
  }

  private async processUpdate(update: TelegramUpdate): Promise<void> {
    if (update.callback_query) {
      await this.handleCallbackQuery(update.callback_query);
      return;
    }

    if (update.message?.text && update.message.chat) {
      const chatId = String(update.message.chat.id);
      // Validate: only process messages from configured chat
      if (chatId !== this.chatId) return;

      const text = update.message.text.trim();
      const messageId = update.message.message_id;

      // Check for pending instruction
      if (this.pendingInstructions.has(chatId) && !text.startsWith('/')) {
        const sessionId = this.pendingInstructions.get(chatId)!;
        this.pendingInstructions.delete(chatId);
        await this.executeInstruction(chatId, sessionId, text);
        return;
      }

      // Slash commands
      if (text.startsWith('/')) {
        await this.handleCommand(chatId, text, messageId);
        return;
      }

      // Natural language
      await this.handleNaturalLanguage(chatId, text);
    }
  }

  // ===== Telegram API Helpers =====

  private async sendMessage(chatId: string, text: string, options?: {
    parse_mode?: 'Markdown' | 'HTML';
    reply_markup?: TelegramInlineKeyboard;
  }): Promise<number | null> {
    try {
      const url = `https://api.telegram.org/bot${this.botToken}/sendMessage`;
      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text,
          parse_mode: options?.parse_mode || 'Markdown',
          reply_markup: options?.reply_markup,
        }),
      });
      const data = await resp.json() as { ok: boolean; result?: { message_id: number } };
      return data.ok ? data.result?.message_id || null : null;
    } catch (err) {
      console.error('[TELEGRAM BOT] sendMessage error:', err);
      return null;
    }
  }

  private async editMessageText(chatId: string, messageId: number, text: string, options?: {
    parse_mode?: 'Markdown' | 'HTML';
    reply_markup?: TelegramInlineKeyboard;
  }): Promise<void> {
    try {
      const url = `https://api.telegram.org/bot${this.botToken}/editMessageText`;
      await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          message_id: messageId,
          text,
          parse_mode: options?.parse_mode || 'Markdown',
          reply_markup: options?.reply_markup,
        }),
      });
    } catch (err) {
      console.error('[TELEGRAM BOT] editMessageText error:', err);
    }
  }

  private async sendChatAction(chatId: string, action: 'typing'): Promise<void> {
    try {
      const url = `https://api.telegram.org/bot${this.botToken}/sendChatAction`;
      await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, action }),
      });
    } catch { /* ignore */ }
  }

  private async answerCallbackQuery(callbackQueryId: string, text?: string): Promise<void> {
    try {
      const url = `https://api.telegram.org/bot${this.botToken}/answerCallbackQuery`;
      await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          callback_query_id: callbackQueryId,
          text,
        }),
      });
    } catch {
      // Ignore callback answer failures
    }
  }

  // ===== Session Resolution =====

  private resolveSessionByName(name: string): { id: string; name: string } | null {
    const sessions = this.watchdog.getAllSessions();
    const lower = name.toLowerCase();
    // Exact match first
    const exact = sessions.find(s => s.name.toLowerCase() === lower);
    if (exact) return { id: exact.id, name: exact.name };
    // Partial match
    const matches = sessions.filter(s => s.name.toLowerCase().includes(lower));
    if (matches.length === 1) { const m = matches[0]!; return { id: m.id, name: m.name }; }
    return null;
  }

  private escMd(text: string): string {
    // Escape markdown special chars for Telegram
    return text.replace(/([_*\[\]()~`>#+\-=|{}.!])/g, '\\$1');
  }

  // ===== Command Dispatcher =====

  private async handleCommand(chatId: string, text: string, _messageId: number): Promise<void> {
    const parts = text.split(/\s+/);
    const cmd = (parts[0] || '').toLowerCase().replace(/@\w+$/, ''); // Remove @botname suffix
    const args = parts.slice(1).join(' ').trim();

    switch (cmd) {
      case '/start':
      case '/help':
        await this.cmdStart(chatId);
        break;
      case '/status':
        await this.cmdStatus(chatId);
        break;
      case '/sessions':
        await this.cmdSessions(chatId);
        break;
      case '/goals':
        await this.cmdGoals(chatId, args || undefined);
        break;
      case '/instruct':
        await this.cmdInstruct(chatId, args || undefined);
        break;
      case '/assess':
        await this.cmdAssess(chatId, args || undefined);
        break;
      case '/pause':
        await this.cmdPause(chatId, args || undefined);
        break;
      case '/resume':
        await this.cmdResume(chatId, args || undefined);
        break;
      case '/activity':
        await this.cmdActivity(chatId, args || undefined);
        break;
      default:
        if (text.startsWith('/')) {
          await this.sendMessage(chatId, 'Unknown command. Use /help for available commands.');
        }
        break;
    }
  }

  // ===== Callback Query Handler =====

  private async handleCallbackQuery(query: TelegramCallbackQuery): Promise<void> {
    if (!query.data || !query.message) return;

    const chatId = String(query.message.chat.id);
    if (chatId !== this.chatId) return;

    const [action, param] = query.data.split(':') as [string, string];
    if (!action) return;
    const messageId = query.message.message_id;

    // Handle natural language quick-action buttons (nl:status, nl:sessions, etc.)
    if (action === 'nl') {
      await this.answerCallbackQuery(query.id);
      switch (param) {
        case 'status': await this.cmdStatus(chatId); break;
        case 'sessions': await this.cmdSessions(chatId); break;
        case 'goals': await this.cmdGoals(chatId); break;
        case 'help': await this.cmdStart(chatId); break;
        default: break;
      }
      return;
    }

    const sessionId = param;
    if (!sessionId) return;

    switch (action) {
      case 'monitor': {
        const monitored = this.watchdog.getMonitoredSessions();
        const isCurrentlyMonitored = monitored.some(s => s.sessionId === sessionId);
        this.watchdog.setSessionMonitored(sessionId, !isCurrentlyMonitored);
        const name = this.watchdog.resolveSessionName(sessionId);
        await this.answerCallbackQuery(query.id, isCurrentlyMonitored ? `${name}: Monitoring OFF` : `${name}: Monitoring ON`);
        // Rebuild sessions list in-place
        await this.renderSessionsMessage(chatId, messageId);
        break;
      }
      case 'goals':
        await this.answerCallbackQuery(query.id);
        await this.cmdGoals(chatId, undefined, sessionId);
        break;
      case 'assess':
        await this.answerCallbackQuery(query.id, 'Assessing...');
        await this.cmdAssess(chatId, undefined, sessionId);
        break;
      case 'pause': {
        this.watchdog.pauseSession(sessionId, 'Paused via Telegram');
        const name = this.watchdog.resolveSessionName(sessionId);
        await this.answerCallbackQuery(query.id, `${name} paused`);
        await this.sendMessage(chatId, `⏸️ *${this.escMd(name)}* paused`);
        break;
      }
      case 'resume': {
        this.watchdog.resumeSession(sessionId);
        const name = this.watchdog.resolveSessionName(sessionId);
        await this.answerCallbackQuery(query.id, `${name} resumed`);
        await this.sendMessage(chatId, `▶️ *${this.escMd(name)}* resumed`);
        break;
      }
      case 'activity':
        await this.answerCallbackQuery(query.id);
        await this.cmdActivity(chatId, undefined, sessionId);
        break;
      case 'instruct':
        await this.answerCallbackQuery(query.id, 'Send your instruction now');
        this.pendingInstructions.set(chatId, sessionId);
        await this.sendMessage(chatId, `📝 Schreib deine Anweisung für <b>${this.escHtml(this.watchdog.resolveSessionName(sessionId))}</b>:`, { parse_mode: 'HTML' });
        break;
      default:
        await this.answerCallbackQuery(query.id, 'Unknown action');
    }
  }

  // ===== Command Implementations =====

  private async cmdStart(chatId: string): Promise<void> {
    const htmlText = [
      '🐕 <b>Teammanager Bot</b>',
      '',
      'Schreib mir einfach wie in einem normalen Chat — ich verstehe natürliche Sprache.',
      '',
      'Beispiele:',
      '• "Wie läuft das Frontend?"',
      '• "Gib dem Backend-Team den Auftrag, die API zu refactoren"',
      '• "Pausiere das Frontend"',
      '• "Bewerte mal das Backend"',
      '',
      '<b>Slash-Commands (Shortcuts):</b>',
      '/status — Übersicht',
      '/sessions — Teams verwalten',
      '/goals — Aufträge anzeigen',
      '/instruct — Auftrag geben',
      '/assess — Team bewerten',
      '/pause /resume — Team pausieren/fortsetzen',
      '/activity — Letzte Aktivität',
    ].join('\n');
    await this.sendMessage(chatId, htmlText, { parse_mode: 'HTML' });
  }

  private async cmdStatus(chatId: string): Promise<void> {
    const status = this.watchdog.getStatus();
    const monitored = this.watchdog.getMonitoredSessions();
    const totalGoals = monitored.reduce((sum, s) => sum + s.goals.length, 0);
    const activeGoals = monitored.reduce((sum, s) =>
      sum + s.goals.filter(g => g.status === 'in_progress' || g.status === 'pending').length, 0);

    const lines = [
      '<b>🐕 Watchdog Status</b>',
      '',
      `Status: ${status.enabled ? '✅ Active' : '❌ Inactive'}`,
      `Profile: ${status.autonomousProfile || 'balanced'}`,
      `Monitored: ${monitored.length} sessions`,
      `Goals: ${activeGoals} active / ${totalGoals} total`,
      `Active Rules: ${status.activeRules}`,
      `Decisions Today: ${status.decisionsToday}`,
      `Paused: ${status.pausedSessions.length} sessions`,
    ];

    const keyboard: TelegramInlineKeyboard = {
      inline_keyboard: [
        [
          { text: '📋 Sessions', callback_data: 'cmd:sessions' },
          { text: '🎯 Goals', callback_data: 'cmd:goals' },
        ],
      ],
    };

    await this.sendMessage(chatId, lines.join('\n'), { parse_mode: 'HTML', reply_markup: keyboard });
  }

  private async cmdSessions(chatId: string): Promise<void> {
    await this.renderSessionsMessage(chatId);
  }

  private async renderSessionsMessage(chatId: string, editMessageId?: number): Promise<void> {
    const allSessions = this.watchdog.getAllSessions();
    const monitored = this.watchdog.getMonitoredSessions();
    const monitoredIds = new Set(monitored.map(m => m.sessionId));

    const monitoredCount = monitored.length;
    const lines: string[] = [
      `<b>📋 Sessions</b> (${allSessions.length} total, ${monitoredCount} monitored)`,
      '',
    ];

    for (const session of allSessions) {
      const isMon = monitoredIds.has(session.id);
      const ms = monitored.find(m => m.sessionId === session.id);
      const icon = isMon ? '🟢' : '⚪';
      const paused = ms?.paused ? ' ⏸️' : '';
      const status = session.status || 'unknown';

      let detail = status;
      if (ms) {
        const goalCount = ms.goals.length;
        const errCount = ms.errorCount;
        const parts = [status];
        if (errCount > 0) parts.push(`Err: ${errCount}`);
        if (goalCount > 0) parts.push(`Goals: ${goalCount}`);
        detail = parts.join(' | ');
      }

      lines.push(`${icon} <b>${this.escHtml(session.name)}</b>${paused}`);
      lines.push(`   ${detail}`);
    }

    if (allSessions.length === 0) {
      lines.push('No sessions found.');
    }

    // Build inline keyboard: 2 buttons per row
    const buttons: TelegramInlineKeyboardButton[][] = [];
    let row: TelegramInlineKeyboardButton[] = [];
    for (const session of allSessions) {
      const isMon = monitoredIds.has(session.id);
      const icon = isMon ? '🟢' : '⚪';
      const label = `${icon} ${session.name.substring(0, 20)}`;
      row.push({ text: label, callback_data: `monitor:${session.id}` });
      if (row.length === 2) {
        buttons.push(row);
        row = [];
      }
    }
    if (row.length > 0) buttons.push(row);

    const keyboard: TelegramInlineKeyboard = { inline_keyboard: buttons };
    const text = lines.join('\n');

    if (editMessageId) {
      await this.editMessageText(chatId, editMessageId, text, { parse_mode: 'HTML', reply_markup: keyboard });
    } else {
      await this.sendMessage(chatId, text, { parse_mode: 'HTML', reply_markup: keyboard });
    }
  }

  private async cmdGoals(chatId: string, sessionName?: string, sessionId?: string): Promise<void> {
    // Resolve session
    if (!sessionId && sessionName) {
      const resolved = this.resolveSessionByName(sessionName);
      if (!resolved) {
        await this.showSessionPicker(chatId, 'goals', `No session matching "${sessionName}". Pick one:`);
        return;
      }
      sessionId = resolved.id;
    }

    if (!sessionId) {
      // Show picker for all monitored sessions
      const monitored = this.watchdog.getMonitoredSessions();
      if (monitored.length === 1 && monitored[0]) {
        sessionId = monitored[0].sessionId;
      } else {
        await this.showSessionPicker(chatId, 'goals', 'Pick a session to see goals:');
        return;
      }
    }

    const sid = sessionId!;
    const name = this.watchdog.resolveSessionName(sid);
    const goals = this.watchdog.getGoals(sid);

    if (goals.length === 0) {
      await this.sendMessage(chatId, `🎯 <b>${this.escHtml(name)}</b>\n\nNo goals defined.`, { parse_mode: 'HTML' });
      return;
    }

    const statusIcon: Record<string, string> = {
      pending: '⏳', in_progress: '🔄', completed: '✅', failed: '❌', paused: '⏸️',
    };

    const lines = [`🎯 <b>Goals — "${this.escHtml(name)}"</b>`, ''];
    for (const [i, g] of goals.entries()) {
      const icon = statusIcon[g.status] || '•';
      lines.push(`${i + 1}. ${icon} ${this.escHtml(g.description)}`);
      const parts: string[] = [];
      if (g.autoMonitor) parts.push(`Monitor: ✅ ${g.iterationCount}/${g.maxIterations || 20}`);
      else parts.push('Monitor: ❌');
      parts.push(g.priority);
      lines.push(`   ${parts.join(' | ')}`);
      if (g.lastEvaluation) {
        const evalText = g.lastEvaluation.substring(0, 100);
        lines.push(`   💬 ${this.escHtml(evalText)}`);
      }
    }

    // Action buttons
    const keyboard: TelegramInlineKeyboard = {
      inline_keyboard: [
        [
          { text: '🔍 Assess', callback_data: `assess:${sid}` },
          { text: '📊 Activity', callback_data: `activity:${sid}` },
        ],
        [
          { text: '📝 Instruct', callback_data: `instruct:${sid}` },
        ],
      ],
    };

    await this.sendMessage(chatId, lines.join('\n'), { parse_mode: 'HTML', reply_markup: keyboard });
  }

  private async cmdInstruct(chatId: string, args?: string): Promise<void> {
    const monitored = this.watchdog.getMonitoredSessions();
    if (monitored.length === 0) {
      await this.sendMessage(chatId, '⚠️ No monitored sessions. Use /sessions to enable monitoring first.', { parse_mode: 'HTML' });
      return;
    }

    // If args contain "sessionName: instruction", parse it
    if (args && args.includes(':')) {
      const colonIdx = args.indexOf(':');
      const sessionPart = args.substring(0, colonIdx).trim();
      const instructionPart = args.substring(colonIdx + 1).trim();
      if (sessionPart && instructionPart) {
        const resolved = this.resolveSessionByName(sessionPart);
        if (resolved) {
          await this.executeInstruction(chatId, resolved.id, instructionPart);
          return;
        }
      }
    }

    // Show session picker
    if (monitored.length === 1 && monitored[0]) {
      this.pendingInstructions.set(chatId, monitored[0].sessionId);
      const name = this.watchdog.resolveSessionName(monitored[0].sessionId);
      await this.sendMessage(chatId, `📝 Send your instruction for <b>${this.escHtml(name)}</b>.\n\nType your message:`, { parse_mode: 'HTML' });
      return;
    }

    await this.showSessionPicker(chatId, 'instruct', '📝 Pick a session to instruct:');
  }

  private async executeInstruction(chatId: string, sessionId: string, instruction: string): Promise<void> {
    const name = this.watchdog.resolveSessionName(sessionId);
    await this.sendMessage(chatId, `⏳ Sending instruction to <b>${this.escHtml(name)}</b>...`, { parse_mode: 'HTML' });

    try {
      const result = await this.watchdog.instructSession(sessionId, instruction, true);
      const lines = [
        `✅ <b>Instruction sent to "${this.escHtml(name)}"</b>`,
        '',
        `📝 ${this.escHtml(instruction.substring(0, 200))}`,
      ];
      if (result.goalId) {
        lines.push(`🎯 Goal created (monitoring active)`);
      }
      if (result.response) {
        lines.push('', `💬 Response: ${this.escHtml(result.response.substring(0, 300))}`);
      }
      await this.sendMessage(chatId, lines.join('\n'), { parse_mode: 'HTML' });
    } catch (err) {
      await this.sendMessage(chatId, `❌ Failed to instruct session: ${String(err)}`, { parse_mode: 'HTML' });
    }
  }

  // ===== Natural Language: Conversational AI Handler =====

  private async handleNaturalLanguage(chatId: string, text: string): Promise<void> {
    // Add to history
    this.chatHistory.push({ role: 'user', text });
    if (this.chatHistory.length > this.MAX_HISTORY) this.chatHistory.shift();

    await this.sendChatAction(chatId, 'typing');

    try {
      const prompt = this.buildConversationPrompt(text);
      const raw = await this.askClaude(prompt);

      // Parse structured response
      let parsed: { reply: string; action?: { type: string; sessionId?: string; instruction?: string } | null };
      try {
        const cleaned = raw.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
        parsed = JSON.parse(cleaned);
      } catch {
        // Claude responded with plain text — use as-is
        parsed = { reply: raw.trim() };
      }

      // Save assistant response to history
      this.chatHistory.push({ role: 'assistant', text: parsed.reply });
      if (this.chatHistory.length > this.MAX_HISTORY) this.chatHistory.shift();

      // Send the conversational reply
      await this.sendMessage(chatId, this.escHtml(parsed.reply), { parse_mode: 'HTML' });

      // Execute action if present
      if (parsed.action && parsed.action.type) {
        await this.executeConversationalAction(chatId, parsed.action);
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error('[TELEGRAM BOT] NL error:', errMsg);
      // Fallback: keyword matching for simple commands
      const sessions = this.watchdog.getAllSessions();
      const intent = this.quickIntentMatch(text, sessions);
      if (intent) {
        await this.executeQuickAction(chatId, intent);
      } else {
        await this.sendMessage(chatId,
          'Ich kann dich gerade nicht erreichen — die KI-Verbindung ist nicht verfügbar.\n\nNutze /help für Befehle oder versuch es gleich nochmal.',
          { parse_mode: 'HTML' }
        );
      }
    }
  }

  // ===== Claude CLI One-Shot =====

  private askClaude(prompt: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const proc = spawn('claude', ['--print'], {
        env: { ...process.env },
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';
      const timeout = setTimeout(() => {
        proc.kill('SIGTERM');
        reject(new Error('Claude CLI timeout (60s)'));
      }, 60000);

      proc.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
      proc.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });
      proc.on('close', (code) => {
        clearTimeout(timeout);
        if (code !== 0) {
          reject(new Error(stderr.substring(0, 300) || `claude exit code ${code}`));
        } else {
          resolve(stdout.trim());
        }
      });
      proc.on('error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });

      proc.stdin.write(prompt);
      proc.stdin.end();
    });
  }

  // ===== Conversation Prompt Builder =====

  private buildConversationPrompt(currentMessage: string): string {
    const sessions = this.watchdog.getAllSessions();
    const monitored = this.watchdog.getMonitoredSessions();

    // Build session context
    const sessionLines = sessions.map(s => {
      const mon = monitored.find(m => m.sessionId === s.id);
      const goals = this.watchdog.getGoals(s.id);
      const goalInfo = goals.length > 0
        ? goals.map(g => `  - [${g.status}] ${g.description.substring(0, 80)}`).join('\n')
        : '  (keine Aufträge)';
      const activity = this.watchdog.getSessionActivity(s.id).slice(0, 3);
      const actInfo = activity.length > 0
        ? activity.map(a => `  - ${new Date(a.timestamp).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })} ${a.summary.substring(0, 60)}`).join('\n')
        : '';
      const status = mon?.paused ? 'PAUSIERT' : s.status || 'idle';
      const monitoring = mon ? 'ja' : 'nein';
      return `Team "${s.name}" (ID: ${s.id})
  Status: ${status} | Monitoring: ${monitoring}
  Aufträge:\n${goalInfo}${actInfo ? '\n  Letzte Aktivität:\n' + actInfo : ''}`;
    }).join('\n\n');

    // Build conversation history
    const historyBlock = this.chatHistory.slice(0, -1).map(h =>
      h.role === 'user' ? `CEO: ${h.text}` : `Du: ${h.text}`
    ).join('\n');

    return `Du bist der Teammanager einer Software-Firma. Der CEO schreibt dir per Chat.
Du verwaltest mehrere Entwicklungsteams (Sessions), gibst Aufträge weiter, berichtest über Fortschritte und triffst operative Entscheidungen.

Antworte natürlich, knapp und direkt — wie ein echter Teammanager per Chat. Kein Roboter-Ton. Deutsch, du-Form.

Deine Teams:
${sessionLines || '(keine Teams aktiv)'}

${historyBlock ? 'Bisheriger Chat:\n' + historyBlock + '\n' : ''}CEO: ${currentMessage}

Antworte NUR mit einem JSON-Objekt (keine Markdown-Fences, kein anderer Text):
{
  "reply": "Deine natürliche Antwort an den CEO",
  "action": null
}

Wenn der CEO einen konkreten Auftrag gibt oder eine Aktion auslösen will, setze action:
{
  "reply": "Deine Antwort",
  "action": {
    "type": "instruct | assess | pause | resume | monitor_on | monitor_off",
    "sessionId": "die Session-ID",
    "instruction": "der Auftrag (nur bei type=instruct)"
  }
}

Regeln:
- Wenn der CEO fragt "wie läuft X" → berichte basierend auf den Daten oben, KEIN action nötig
- Wenn der CEO einen Auftrag gibt ("mach X", "bau Y", "fix Z") → action type=instruct, finde das passende Team
- Wenn der CEO ein Team bewerten will → action type=assess
- Wenn er pausieren/fortsetzen will → pause/resume
- Bei allgemeinen Fragen oder Smalltalk → antworte einfach natürlich, action: null
- Beziehe dich auf den Chatverlauf wenn relevant
- Sei proaktiv: wenn etwas auffällt (Fehler, Stillstand), erwähne es
- Halte Antworten kurz (2-4 Sätze max), wie in einem echten Chat`;
  }

  // ===== Execute Conversational Action =====

  private async executeConversationalAction(chatId: string, action: {
    type: string;
    sessionId?: string;
    instruction?: string;
  }): Promise<void> {
    const sid = action.sessionId;

    switch (action.type) {
      case 'instruct':
        if (sid && action.instruction) {
          await this.executeInstruction(chatId, sid, action.instruction);
        } else if (!sid) {
          await this.showSessionPicker(chatId, 'instruct', '📝 Welches Team?');
        }
        break;
      case 'assess':
        await this.cmdAssess(chatId, undefined, sid || undefined);
        break;
      case 'pause':
        if (sid) {
          this.watchdog.pauseSession(sid, 'Paused via Telegram');
        } else {
          await this.showSessionPicker(chatId, 'pause', '⏸️ Welches Team pausieren?');
        }
        break;
      case 'resume':
        if (sid) {
          this.watchdog.resumeSession(sid);
        } else {
          await this.showSessionPicker(chatId, 'resume', '▶️ Welches Team fortsetzen?');
        }
        break;
      case 'monitor_on':
        if (sid) this.watchdog.setSessionMonitored(sid, true);
        break;
      case 'monitor_off':
        if (sid) this.watchdog.setSessionMonitored(sid, false);
        break;
    }
  }

  // ===== Quick Intent Matching (offline fallback) =====

  private quickIntentMatch(
    text: string,
    sessions: Array<{ id: string; name: string; status: string }>
  ): { action: string; sessionId?: string; message?: string } | null {
    const lower = text.toLowerCase().trim();

    if (/^(status|übersicht|wie (geht'?s|läuft'?s))\??$/i.test(lower)) return { action: 'status' };
    if (/^(sessions?|teams?)$/i.test(lower)) return { action: 'sessions' };
    if (/^(help|hilfe)$/i.test(lower)) return { action: 'help' };
    if (/^(goals?|ziele?|aufträge)$/i.test(lower)) return { action: 'goals' };

    // "pausiere X"
    const pauseM = lower.match(/^(?:pausiere?|pause|stopp?)\s+(.+)$/i);
    if (pauseM) {
      const r = this.resolveSessionByName(pauseM[1]!.trim());
      if (r) return { action: 'pause', sessionId: r.id };
    }

    // "SessionName: instruction"
    for (const s of sessions) {
      const sL = s.name.toLowerCase();
      if (sL.length < 2) continue;
      if (lower.startsWith(sL + ':') || lower.startsWith(sL + ',')) {
        const instr = text.substring(s.name.length).replace(/^[:\s,]+/, '').trim();
        if (instr) return { action: 'instruct', sessionId: s.id, message: instr };
      }
    }

    return null;
  }

  private async executeQuickAction(chatId: string, intent: { action: string; sessionId?: string; message?: string }): Promise<void> {
    switch (intent.action) {
      case 'status': await this.cmdStatus(chatId); break;
      case 'sessions': await this.cmdSessions(chatId); break;
      case 'help': await this.cmdStart(chatId); break;
      case 'goals': await this.cmdGoals(chatId); break;
      case 'pause':
        if (intent.sessionId) {
          this.watchdog.pauseSession(intent.sessionId, 'Paused via Telegram');
          const name = this.watchdog.resolveSessionName(intent.sessionId);
          await this.sendMessage(chatId, `⏸️ <b>${this.escHtml(name)}</b> pausiert.`, { parse_mode: 'HTML' });
        }
        break;
      case 'instruct':
        if (intent.sessionId && intent.message) {
          await this.executeInstruction(chatId, intent.sessionId, intent.message);
        }
        break;
    }
  }

  private async cmdAssess(chatId: string, sessionName?: string, sessionId?: string): Promise<void> {
    if (!sessionId && sessionName) {
      const resolved = this.resolveSessionByName(sessionName);
      if (!resolved) {
        await this.showSessionPicker(chatId, 'assess', `No session matching "${sessionName}". Pick one:`);
        return;
      }
      sessionId = resolved.id;
    }

    if (!sessionId) {
      await this.showSessionPicker(chatId, 'assess', '🔍 Pick a session to assess:');
      return;
    }

    const name = this.watchdog.resolveSessionName(sessionId);
    await this.sendMessage(chatId, `🔍 Assessing <b>${this.escHtml(name)}</b>...`, { parse_mode: 'HTML' });

    try {
      const assessment = await this.watchdog.assessSession(sessionId);
      if (assessment) {
        await this.sendMessage(chatId, `🔍 <b>Assessment — "${this.escHtml(name)}"</b>\n\n${this.escHtml(assessment)}`, { parse_mode: 'HTML' });
      } else {
        await this.sendMessage(chatId, `🔍 <b>${this.escHtml(name)}</b>: No assessment available (CLI may not be active).`, { parse_mode: 'HTML' });
      }
    } catch (err) {
      await this.sendMessage(chatId, `❌ Assessment failed: ${String(err)}`, { parse_mode: 'HTML' });
    }
  }

  private async cmdPause(chatId: string, sessionName?: string): Promise<void> {
    if (!sessionName) {
      await this.showSessionPicker(chatId, 'pause', '⏸️ Pick a session to pause:');
      return;
    }
    const resolved = this.resolveSessionByName(sessionName);
    if (!resolved) {
      await this.showSessionPicker(chatId, 'pause', `No session matching "${sessionName}". Pick one:`);
      return;
    }
    this.watchdog.pauseSession(resolved.id, 'Paused via Telegram');
    await this.sendMessage(chatId, `⏸️ <b>${this.escHtml(resolved.name)}</b> paused.`, { parse_mode: 'HTML' });
  }

  private async cmdResume(chatId: string, sessionName?: string): Promise<void> {
    if (!sessionName) {
      await this.showSessionPicker(chatId, 'resume', '▶️ Pick a session to resume:');
      return;
    }
    const resolved = this.resolveSessionByName(sessionName);
    if (!resolved) {
      await this.showSessionPicker(chatId, 'resume', `No session matching "${sessionName}". Pick one:`);
      return;
    }
    this.watchdog.resumeSession(resolved.id);
    await this.sendMessage(chatId, `▶️ <b>${this.escHtml(resolved.name)}</b> resumed.`, { parse_mode: 'HTML' });
  }

  private async cmdActivity(chatId: string, sessionName?: string, sessionId?: string): Promise<void> {
    if (!sessionId && sessionName) {
      const resolved = this.resolveSessionByName(sessionName);
      if (!resolved) {
        await this.showSessionPicker(chatId, 'activity', `No session matching "${sessionName}". Pick one:`);
        return;
      }
      sessionId = resolved.id;
    }

    if (!sessionId) {
      await this.showSessionPicker(chatId, 'activity', '📊 Pick a session to see activity:');
      return;
    }

    const name = this.watchdog.resolveSessionName(sessionId);
    const activity = this.watchdog.getSessionActivity(sessionId);
    const recent = activity.slice(0, 15);

    if (recent.length === 0) {
      await this.sendMessage(chatId, `📊 <b>${this.escHtml(name)}</b>\n\nNo recent activity.`, { parse_mode: 'HTML' });
      return;
    }

    const typeIcon: Record<string, string> = {
      message: '💬', tool: '🔧', error: '🚨', status: '📋',
    };

    const lines = [`📊 <b>Activity — "${this.escHtml(name)}"</b>`, ''];
    for (const entry of recent) {
      const time = new Date(entry.timestamp).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
      const icon = typeIcon[entry.type] || '•';
      lines.push(`${time} ${icon} ${this.escHtml(entry.summary.substring(0, 80))}`);
    }

    await this.sendMessage(chatId, lines.join('\n'), { parse_mode: 'HTML' });
  }

  // ===== Helpers =====

  private async showSessionPicker(chatId: string, action: string, prompt: string): Promise<void> {
    const monitored = this.watchdog.getMonitoredSessions();
    const allSessions = this.watchdog.getAllSessions();

    // For most actions, show monitored sessions. For 'monitor', show all.
    const sessions = action === 'monitor' ? allSessions.map(s => ({ sessionId: s.id, name: s.name })) :
      monitored.length > 0 ? monitored.map(s => ({ sessionId: s.sessionId, name: this.watchdog.resolveSessionName(s.sessionId) })) :
      allSessions.map(s => ({ sessionId: s.id, name: s.name }));

    if (sessions.length === 0) {
      await this.sendMessage(chatId, '⚠️ No sessions available.', { parse_mode: 'HTML' });
      return;
    }

    const buttons: TelegramInlineKeyboardButton[][] = [];
    let row: TelegramInlineKeyboardButton[] = [];
    for (const s of sessions) {
      row.push({ text: s.name.substring(0, 25), callback_data: `${action}:${s.sessionId}` });
      if (row.length === 2) {
        buttons.push(row);
        row = [];
      }
    }
    if (row.length > 0) buttons.push(row);

    await this.sendMessage(chatId, prompt, {
      parse_mode: 'HTML',
      reply_markup: { inline_keyboard: buttons },
    });
  }

  private escHtml(text: string): string {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
}
