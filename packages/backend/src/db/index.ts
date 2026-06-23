import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import bcrypt from 'bcryptjs';
import { nanoid } from 'nanoid';
import { estimateModelCost, LLM_PRICING_RATE_CARD_VERSION } from '@plum-code-webui/shared';
import { safeEncrypt, isEncryptionAvailable, decrypt } from '../utils/encryption.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.join(__dirname, '..', '..', 'data', 'claude-webui.db');

let db: Database.Database;

export function getDatabase(): Database.Database {
  if (!db) {
    throw new Error('Database not initialized. Call initDatabase() first.');
  }
  return db;
}

export function initDatabase(): Database.Database {
  // Ensure data directory exists
  const dataDir = path.dirname(DB_PATH);
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  // Run migrations
  runMigrations(db);

  return db;
}

function runMigrations(db: Database.Database): void {
  db.exec(`
    -- Users table
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      name TEXT,
      avatar_url TEXT,
      provider TEXT NOT NULL,
      provider_id TEXT NOT NULL,
      api_key_encrypted TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(provider, provider_id)
    );

    -- Sessions table
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      working_directory TEXT NOT NULL,
      claude_session_id TEXT,
      status TEXT DEFAULT 'stopped',
      last_message TEXT,
      starred INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- Messages table
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- User settings table
    CREATE TABLE IF NOT EXISTS user_settings (
      user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      theme TEXT DEFAULT 'dark',
      default_working_dir TEXT,
      allowed_tools TEXT,
      custom_system_prompt TEXT,
      settings_json TEXT
    );

    -- MCP servers table
    CREATE TABLE IF NOT EXISTS mcp_servers (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      command TEXT,
      args TEXT,
      url TEXT,
      env TEXT,
      enabled INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- CLI tools table (for orchestrating other AI CLI tools like Codex)
    CREATE TABLE IF NOT EXISTS cli_tools (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      command TEXT NOT NULL,
      description TEXT,
      use_session_cwd INTEGER DEFAULT 1,
      timeout_seconds INTEGER DEFAULT 300,
      enabled INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- Claude OAuth tokens table
    CREATE TABLE IF NOT EXISTS claude_tokens (
      user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      access_token TEXT NOT NULL,
      refresh_token TEXT,
      expires_at DATETIME,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- Usage history table (for analytics)
    CREATE TABLE IF NOT EXISTS usage_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      input_tokens INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0,
      cache_read_tokens INTEGER NOT NULL DEFAULT 0,
      cache_creation_tokens INTEGER NOT NULL DEFAULT 0,
      total_tokens INTEGER NOT NULL DEFAULT 0,
      cost_usd REAL NOT NULL DEFAULT 0,
      model TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- Session checkpoints table (for versioning)
    CREATE TABLE IF NOT EXISTS session_checkpoints (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      description TEXT,
      message_count INTEGER NOT NULL DEFAULT 0,
      snapshot_data TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- Custom agents table
    CREATE TABLE IF NOT EXISTS custom_agents (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      description TEXT,
      system_prompt TEXT NOT NULL,
      model TEXT DEFAULT 'gpt-5.5',
      allowed_tools TEXT,
      permission_mode TEXT DEFAULT 'auto-accept',
      icon TEXT DEFAULT 'bot',
      color TEXT DEFAULT 'violet',
      enabled INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- App config table (for basic auth and other app-wide settings)
    CREATE TABLE IF NOT EXISTS app_config (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- Indexes
    CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_updated_at ON sessions(updated_at);
    CREATE INDEX IF NOT EXISTS idx_sessions_user_updated ON sessions(user_id, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_messages_session_id ON messages(session_id);
    CREATE INDEX IF NOT EXISTS idx_messages_session_created ON messages(session_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_mcp_servers_user_id ON mcp_servers(user_id);
    CREATE INDEX IF NOT EXISTS idx_cli_tools_user_id ON cli_tools(user_id);
    CREATE INDEX IF NOT EXISTS idx_usage_history_user_id ON usage_history(user_id);
    CREATE INDEX IF NOT EXISTS idx_usage_history_session_id ON usage_history(session_id);
    CREATE INDEX IF NOT EXISTS idx_usage_history_created_at ON usage_history(created_at);
    -- Composite index so analytics range queries (WHERE user_id = ? AND created_at >= ...)
    -- use a single index seek instead of a full scan of the user's rows.
    CREATE INDEX IF NOT EXISTS idx_usage_history_user_created ON usage_history(user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_usage_history_session_created ON usage_history(session_id, created_at DESC);

    -- Session events table (non-billing telemetry such as live context window
    -- snapshots and context compaction boundaries). Keep this separate from
    -- usage_history so analytics cost/request math only counts real LLM turns.
    CREATE TABLE IF NOT EXISTS session_events (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      event_type TEXT NOT NULL,
      provider TEXT,
      model TEXT,
      input_tokens INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0,
      cache_read_tokens INTEGER NOT NULL DEFAULT 0,
      cache_creation_tokens INTEGER NOT NULL DEFAULT 0,
      total_tokens INTEGER NOT NULL DEFAULT 0,
      context_window INTEGER NOT NULL DEFAULT 0,
      context_used_percent REAL NOT NULL DEFAULT 0,
      context_exceeded INTEGER NOT NULL DEFAULT 0,
      reason TEXT,
      message TEXT,
      summary TEXT,
      metadata_json TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_session_events_user_created ON session_events(user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_session_events_session_created ON session_events(session_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_session_events_type_created ON session_events(event_type, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_session_checkpoints_session_id ON session_checkpoints(session_id);
    CREATE INDEX IF NOT EXISTS idx_custom_agents_user_id ON custom_agents(user_id);
    CREATE INDEX IF NOT EXISTS idx_custom_agents_updated_at ON custom_agents(updated_at);
    CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
    CREATE INDEX IF NOT EXISTS idx_users_provider ON users(provider, provider_id);
  `);

  // Initialize default basic auth credentials
  initializeBasicAuth(db);

  // Migration: Add starred column to existing sessions table
  try {
    db.exec(`ALTER TABLE sessions ADD COLUMN starred INTEGER DEFAULT 0`);
  } catch {
    // Column already exists, ignore error
  }

  // Migration: Add allowed_directories column to sessions table
  try {
    db.exec(`ALTER TABLE sessions ADD COLUMN allowed_directories TEXT DEFAULT '[]'`);
  } catch {
    // Column already exists, ignore error
  }

  // Migration: Add category column to sessions table
  try {
    db.exec(`ALTER TABLE sessions ADD COLUMN category TEXT DEFAULT NULL`);
  } catch {
    // Column already exists, ignore error
  }

  // Migration: Add cli_provider column to sessions table
  try {
    db.exec(`ALTER TABLE sessions ADD COLUMN cli_provider TEXT DEFAULT 'codex'`);
  } catch {
    // Column already exists, ignore error
  }

  // Migration: Add mode column to sessions table (permission mode: auto-accept, plan, etc.)
  // Persists per-session so it survives browser/device switches instead of living in localStorage.
  try {
    db.exec(`ALTER TABLE sessions ADD COLUMN mode TEXT DEFAULT 'auto-accept'`);
  } catch {
    // Column already exists, ignore error
  }

  // Migration: Add session surface. "code" is the existing technical workbench;
  // "task" is a quieter messenger-style surface over the same provider runtime.
  try {
    db.exec(`ALTER TABLE sessions ADD COLUMN surface TEXT DEFAULT 'code'`);
  } catch {
    // Column already exists, ignore error
  }

  // Migration: Add per-session CLI model selection so multiple WebUI sessions can
  // run different provider/model pairs for the same user.
  try {
    db.exec(`ALTER TABLE sessions ADD COLUMN cli_model TEXT DEFAULT NULL`);
  } catch {
    // Column already exists, ignore error
  }

  // Migration: Add per-session reasoning / effort selection. Like cli_model, this
  // must not be user-global because high/xhigh style settings affect usage limits.
  try {
    db.exec(`ALTER TABLE sessions ADD COLUMN cli_reasoning TEXT DEFAULT NULL`);
  } catch {
    // Column already exists, ignore error
  }

  // Migration: Add per-session Codex service/profile tier. This is intentionally
  // separate from cli_reasoning so `/fast` can be combined with xhigh effort.
  try {
    db.exec(`ALTER TABLE sessions ADD COLUMN cli_service_tier TEXT DEFAULT NULL`);
  } catch {
    // Column already exists, ignore error
  }

  try {
    db.exec(`
      UPDATE sessions
      SET cli_service_tier = 'fast',
          cli_reasoning = NULL
      WHERE cli_provider = 'codex'
        AND cli_reasoning = 'fast'
        AND (cli_service_tier IS NULL OR cli_service_tier = '')
    `);
  } catch {
    // Best-effort cleanup; older schemas may not have both columns during startup.
  }

  // Migration: Add per-session style library selections.
  try {
    db.exec(`ALTER TABLE sessions ADD COLUMN design_style_skill TEXT DEFAULT NULL`);
  } catch {
    // Column already exists, ignore error
  }

  try {
    db.exec(`ALTER TABLE sessions ADD COLUMN writing_style_skill TEXT DEFAULT NULL`);
  } catch {
    // Column already exists, ignore error
  }

  // Migration: Bind one Android ADB test device to a WebUI session. The Android
  // builder keeps the persistent wifi pairing registry; the session only stores
  // the selected serial so MCP tools and prompts know which live device to use.
  try {
    db.exec(`ALTER TABLE sessions ADD COLUMN android_device_serial TEXT DEFAULT NULL`);
  } catch {
    // Column already exists, ignore error
  }

  // Migration: Per-session custom icon. The file itself is copied into backend
  // appdata and served through an authenticated session route.
  try {
    db.exec(`ALTER TABLE sessions ADD COLUMN icon_path TEXT DEFAULT NULL`);
  } catch {
    // Column already exists, ignore error
  }

  try {
    db.exec(`ALTER TABLE sessions ADD COLUMN icon_source TEXT DEFAULT NULL`);
  } catch {
    // Column already exists, ignore error
  }

  // Create session_categories table
  db.exec(`
    CREATE TABLE IF NOT EXISTS session_categories (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      color TEXT DEFAULT 'blue',
      icon TEXT DEFAULT 'folder',
      sort_order INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_session_categories_user_id ON session_categories(user_id);

    -- The sessions.category column was added via ALTER TABLE, so we can't add a FOREIGN KEY
    -- constraint. This trigger enforces ON DELETE SET NULL semantics at the DB level, so
    -- direct SQL category deletes (bypassing the route handler) don't leave orphan references.
    CREATE TRIGGER IF NOT EXISTS trg_session_categories_after_delete
    AFTER DELETE ON session_categories
    BEGIN
      UPDATE sessions SET category = NULL WHERE category = OLD.id;
    END;
  `);

  // FTS5 virtual table for message full-text search. LIKE '%x%' does a full scan and can't
  // use a btree index; FTS5 provides fast prefix + phrase search across millions of rows.
  // Triggers keep the FTS index in sync with the messages table automatically.
  try {
    db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
        content,
        content='messages',
        content_rowid='rowid',
        tokenize='unicode61 remove_diacritics 2'
      );

      CREATE TRIGGER IF NOT EXISTS trg_messages_fts_insert
      AFTER INSERT ON messages BEGIN
        INSERT INTO messages_fts(rowid, content) VALUES (new.rowid, new.content);
      END;

      CREATE TRIGGER IF NOT EXISTS trg_messages_fts_delete
      AFTER DELETE ON messages BEGIN
        INSERT INTO messages_fts(messages_fts, rowid, content) VALUES('delete', old.rowid, old.content);
      END;

      CREATE TRIGGER IF NOT EXISTS trg_messages_fts_update
      AFTER UPDATE ON messages BEGIN
        INSERT INTO messages_fts(messages_fts, rowid, content) VALUES('delete', old.rowid, old.content);
        INSERT INTO messages_fts(messages_fts, rowid, content) VALUES (new.rowid, new.content);
      END;
    `);

    // Backfill: populate FTS table from existing messages if it is empty. Only runs once.
    const ftsCount = db.prepare('SELECT COUNT(*) as c FROM messages_fts').get() as { c: number };
    if (ftsCount.c === 0) {
      const msgCount = db.prepare('SELECT COUNT(*) as c FROM messages').get() as { c: number };
      if (msgCount.c > 0) {
        db.exec(`INSERT INTO messages_fts(rowid, content) SELECT rowid, content FROM messages`);
        console.log(`[DB] Backfilled messages_fts with ${msgCount.c} rows.`);
      }
    }
  } catch (err) {
    // FTS5 may be disabled in some SQLite builds — fail soft, keep LIKE fallback.
    console.warn('[DB] FTS5 setup failed (search will fall back to LIKE):', err);
  }

  // Create notes table for prompt notepad
  db.exec(`
    CREATE TABLE IF NOT EXISTS notes (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL,
      title TEXT NOT NULL DEFAULT 'Untitled',
      content TEXT NOT NULL DEFAULT '',
      pinned INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_notes_user_id ON notes(user_id);
    CREATE INDEX IF NOT EXISTS idx_notes_session_id ON notes(session_id);
  `);

  // Create ai_providers table for multi-provider support
  db.exec(`
    CREATE TABLE IF NOT EXISTS ai_providers (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      api_key_encrypted TEXT,
      base_url TEXT,
      models TEXT,
      default_model TEXT,
      enabled INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_ai_providers_user_id ON ai_providers(user_id);
  `);

  // Migration: Add OAuth columns to ai_providers for subscription-based auth
  try {
    db.exec(`ALTER TABLE ai_providers ADD COLUMN oauth_access_token TEXT`);
  } catch {
    // Column already exists
  }
  try {
    db.exec(`ALTER TABLE ai_providers ADD COLUMN oauth_refresh_token TEXT`);
  } catch {
    // Column already exists
  }
  try {
    db.exec(`ALTER TABLE ai_providers ADD COLUMN oauth_expires_at DATETIME`);
  } catch {
    // Column already exists
  }
  try {
    db.exec(`ALTER TABLE ai_providers ADD COLUMN auth_method TEXT DEFAULT 'api_key'`);
  } catch {
    // Column already exists
  }

  // Migration: Backfill-encrypt OAuth tokens stored before F2. Runs once,
  // gated on the presence of ENCRYPTION_KEY so a misconfigured deploy does
  // not silently leave tokens plaintext.
  backfillEncryptOauthTokens(db);

  // Create trusted devices table (for Electron desktop app auth)
  db.exec(`
    CREATE TABLE IF NOT EXISTS trusted_devices (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      device_name TEXT NOT NULL,
      fingerprint_hash TEXT NOT NULL UNIQUE,
      platform TEXT,
      last_seen_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_trusted_devices_user_id ON trusted_devices(user_id);
    CREATE INDEX IF NOT EXISTS idx_trusted_devices_fingerprint ON trusted_devices(fingerprint_hash);
  `);

  // Migration: Add password_hash column to users table for multi-user basic auth
  try {
    db.exec(`ALTER TABLE users ADD COLUMN password_hash TEXT`);
  } catch {
    // Column already exists
  }

  // Migration: Move legacy single-credential basic_auth password into the matching user record
  try {
    const legacyUsername = db
      .prepare("SELECT value FROM app_config WHERE key = 'basic_auth_username'")
      .get() as { value: string } | undefined;
    const legacyHash = db
      .prepare("SELECT value FROM app_config WHERE key = 'basic_auth_password'")
      .get() as { value: string } | undefined;
    if (legacyUsername?.value && legacyHash?.value) {
      db.prepare(
        "UPDATE users SET password_hash = ? WHERE name = ? AND (password_hash IS NULL OR password_hash = '')"
      ).run(legacyHash.value, legacyUsername.value);
    }
  } catch {
    // ignore migration errors
  }

  // Migration: Role/status columns for RBAC (admin console).
  // role:  'user' | 'admin'   — admin unlocks /api/admin/* and can access any session
  // status: 'active' | 'suspended' — suspended blocks login and WS auth
  try {
    db.exec(`ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'user'`);
  } catch {
    /* exists */
  }
  try {
    db.exec(`ALTER TABLE users ADD COLUMN status TEXT NOT NULL DEFAULT 'active'`);
  } catch {
    /* exists */
  }
  try {
    db.exec(`ALTER TABLE users ADD COLUMN last_login_at DATETIME`);
  } catch {
    /* exists */
  }
  db.exec(`CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);`);

  // Audit log — records privileged admin actions and auth events. Append-only from app code.
  db.exec(`
    CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      actor_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      action TEXT NOT NULL,
      resource_type TEXT,
      resource_id TEXT,
      ip TEXT,
      user_agent TEXT,
      metadata_json TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_audit_log_actor ON audit_log(actor_user_id);
    CREATE INDEX IF NOT EXISTS idx_audit_log_created ON audit_log(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_audit_log_action ON audit_log(action);
  `);

  // Automation API tokens let a CLI session or supervisor bot act on behalf of a
  // user without receiving the user's browser cookie/JWT. Store only token hashes.
  db.exec(`
    CREATE TABLE IF NOT EXISTS automation_tokens (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      token_prefix TEXT NOT NULL,
      scopes_json TEXT NOT NULL,
      expires_at DATETIME,
      revoked_at DATETIME,
      last_used_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_automation_tokens_user_id ON automation_tokens(user_id);
    CREATE INDEX IF NOT EXISTS idx_automation_tokens_hash ON automation_tokens(token_hash);
    CREATE INDEX IF NOT EXISTS idx_automation_tokens_revoked ON automation_tokens(revoked_at);

    CREATE TABLE IF NOT EXISTS session_goals (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      created_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      created_by_token_id TEXT REFERENCES automation_tokens(id) ON DELETE SET NULL,
      title TEXT NOT NULL,
      instructions TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      priority INTEGER NOT NULL DEFAULT 0,
      metadata_json TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_session_goals_session_id ON session_goals(session_id);
    CREATE INDEX IF NOT EXISTS idx_session_goals_status ON session_goals(status);
    CREATE INDEX IF NOT EXISTS idx_session_goals_created ON session_goals(created_at DESC);

    CREATE TABLE IF NOT EXISTS session_peer_profiles (
      session_id TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
      alias TEXT NOT NULL,
      description TEXT,
      enabled INTEGER NOT NULL DEFAULT 1,
      visibility TEXT NOT NULL DEFAULT 'private',
      inbox_policy TEXT NOT NULL DEFAULT 'queue',
      capabilities_json TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_session_peer_profiles_enabled ON session_peer_profiles(enabled);

    CREATE TABLE IF NOT EXISTS session_peer_links (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      source_session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      target_session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      role TEXT,
      enabled INTEGER NOT NULL DEFAULT 1,
      metadata_json TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, source_session_id, target_session_id)
    );
    CREATE INDEX IF NOT EXISTS idx_session_peer_links_source ON session_peer_links(source_session_id);
    CREATE INDEX IF NOT EXISTS idx_session_peer_links_target ON session_peer_links(target_session_id);
    CREATE INDEX IF NOT EXISTS idx_session_peer_links_user ON session_peer_links(user_id);

    CREATE TABLE IF NOT EXISTS session_delegations (
      id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL,
      correlation_id TEXT NOT NULL,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      from_session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL,
      to_session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      from_actor TEXT NOT NULL DEFAULT 'session',
      kind TEXT NOT NULL DEFAULT 'consult',
      status TEXT NOT NULL DEFAULT 'queued',
      content TEXT NOT NULL,
      result TEXT,
      error TEXT,
      hop_count INTEGER NOT NULL DEFAULT 0,
      expires_at DATETIME,
      metadata_json TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_session_delegations_user_created ON session_delegations(user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_session_delegations_from ON session_delegations(from_session_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_session_delegations_to ON session_delegations(to_session_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_session_delegations_correlation ON session_delegations(correlation_id);

    CREATE TABLE IF NOT EXISTS container_watchdogs (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      container_id TEXT NOT NULL,
      container_name TEXT NOT NULL,
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      enabled INTEGER NOT NULL DEFAULT 1,
      autonomy_level TEXT NOT NULL DEFAULT 'observe',
      last_snapshot_at DATETIME,
      last_incident_at DATETIME,
      metadata_json TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_container_watchdogs_user_container ON container_watchdogs(user_id, container_id);
    CREATE INDEX IF NOT EXISTS idx_container_watchdogs_session ON container_watchdogs(session_id);
    CREATE INDEX IF NOT EXISTS idx_container_watchdogs_enabled ON container_watchdogs(enabled);

    CREATE TABLE IF NOT EXISTS container_health_snapshots (
      id TEXT PRIMARY KEY,
      watchdog_id TEXT REFERENCES container_watchdogs(id) ON DELETE CASCADE,
      container_id TEXT NOT NULL,
      state TEXT,
      health TEXT,
      restart_count INTEGER,
      cpu_percent REAL,
      memory_bytes INTEGER,
      memory_limit_bytes INTEGER,
      summary TEXT,
      evidence_json TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_container_health_watchdog_created ON container_health_snapshots(watchdog_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_container_health_container_created ON container_health_snapshots(container_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS discord_outbox (
      id TEXT PRIMARY KEY,
      user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL,
      event_type TEXT NOT NULL,
      severity TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      title TEXT NOT NULL,
      summary TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      next_attempt_at DATETIME,
      sent_at DATETIME,
      error TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_discord_outbox_status_next ON discord_outbox(status, next_attempt_at);
    CREATE INDEX IF NOT EXISTS idx_discord_outbox_created ON discord_outbox(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_discord_outbox_user_created ON discord_outbox(user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_discord_outbox_session_created ON discord_outbox(session_id, created_at DESC);
  `);

  // Bootstrap: promote SEED_ADMIN_EMAIL to admin role, or promote the first existing user
  // if no admin exists yet. Runs on every start so a fresh deploy with an env change takes
  // effect without manual SQL.
  try {
    const adminCount = db.prepare(`SELECT COUNT(*) as c FROM users WHERE role = 'admin'`).get() as {
      c: number;
    };
    const seedAdmin = process.env.SEED_ADMIN_EMAIL?.trim().toLowerCase();

    if (seedAdmin) {
      const promoted = db
        .prepare(
          `UPDATE users SET role = 'admin', updated_at = CURRENT_TIMESTAMP
                  WHERE LOWER(email) = ? AND role != 'admin'`
        )
        .run(seedAdmin);
      if (promoted.changes > 0) {
        console.log(`[DB] Promoted ${seedAdmin} to admin (SEED_ADMIN_EMAIL).`);
      }
    } else if (adminCount.c === 0) {
      // No admin yet and no seed email — promote the earliest-created user so the system
      // always has a reachable admin.
      const first = db
        .prepare(`SELECT id, email FROM users ORDER BY created_at ASC LIMIT 1`)
        .get() as { id: string; email: string } | undefined;
      if (first) {
        db.prepare(
          `UPDATE users SET role = 'admin', updated_at = CURRENT_TIMESTAMP WHERE id = ?`
        ).run(first.id);
        console.log(`[DB] No admin found — promoted ${first.email} (earliest user) to admin.`);
      }
    }
  } catch (err) {
    console.error('[DB] Admin bootstrap failed:', err);
  }

  // Optional seed user via ENV (for local dev / first-boot bootstrap).
  // Set SEED_USER_EMAIL, SEED_USER_NAME, SEED_USER_PASSWORD to create a user on startup.
  // Never commit credentials to source. Password is read from env only.
  const seedEmail = process.env.SEED_USER_EMAIL?.trim();
  const seedPassword = process.env.SEED_USER_PASSWORD;
  const seedName = process.env.SEED_USER_NAME?.trim() || seedEmail?.split('@')[0];
  if (seedEmail && seedPassword && seedName) {
    try {
      const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(seedEmail) as
        | { id: string }
        | undefined;
      if (!existing) {
        const userId = nanoid();
        const passwordHash = bcrypt.hashSync(seedPassword, 10);
        db.prepare(
          `INSERT INTO users (id, email, name, avatar_url, provider, provider_id, password_hash)
           VALUES (?, ?, ?, ?, 'cli', ?, ?)`
        ).run(userId, seedEmail, seedName, null, `local-cli-${seedName}`, passwordHash);
        db.prepare(
          `INSERT INTO user_settings (user_id, theme, allowed_tools)
           VALUES (?, 'dark', '["Bash","Read","Write","Edit","Glob","Grep"]')`
        ).run(userId);
        console.log(`[DB] Seeded user ${seedEmail} from SEED_USER_* env vars.`);
      }
    } catch (err) {
      console.error('[DB] Failed to seed user from env:', err);
    }
  }

  repriceUsageHistoryCosts(db);
  backfillGpt55ContextSnapshotWindows(db);
}

function repriceUsageHistoryCosts(database: Database.Database): void {
  const markerKey = 'usage_history_cost_rate_card_version';
  const marker = database.prepare('SELECT value FROM app_config WHERE key = ?').get(markerKey) as
    | { value: string }
    | undefined;
  if (marker?.value === LLM_PRICING_RATE_CARD_VERSION) return;

  const rows = database
    .prepare(
      `
      SELECT
        id,
        model,
        input_tokens,
        output_tokens,
        cache_read_tokens,
        cache_creation_tokens,
        cost_usd
      FROM usage_history
    `
    )
    .all() as Array<{
    id: number;
    model: string | null;
    input_tokens: number;
    output_tokens: number;
    cache_read_tokens: number;
    cache_creation_tokens: number;
    cost_usd: number;
  }>;

  const updateCost = database.prepare('UPDATE usage_history SET cost_usd = ? WHERE id = ?');
  const upsertMarker = database.prepare(
    `
    INSERT INTO app_config (key, value, updated_at)
    VALUES (?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
  `
  );

  let updated = 0;
  let skipped = 0;
  let oldTotal = 0;
  let newTotal = 0;

  const tx = database.transaction(() => {
    for (const row of rows) {
      const estimate = estimateModelCost(
        row.model,
        {
          inputTokens: row.input_tokens,
          outputTokens: row.output_tokens,
          cacheReadTokens: row.cache_read_tokens,
          cacheCreationTokens: row.cache_creation_tokens,
        },
        null
      );

      oldTotal += row.cost_usd || 0;
      if (!estimate.known) {
        skipped += 1;
        newTotal += row.cost_usd || 0;
        continue;
      }

      newTotal += estimate.cost;
      if (Math.abs((row.cost_usd || 0) - estimate.cost) >= 0.0000005) {
        updateCost.run(estimate.cost, row.id);
        updated += 1;
      }
    }

    upsertMarker.run(markerKey, LLM_PRICING_RATE_CARD_VERSION);
  });

  try {
    tx();
    if (rows.length > 0) {
      console.log(
        `[DB] Repriced usage_history costs with ${LLM_PRICING_RATE_CARD_VERSION}: ` +
          `${updated}/${rows.length} rows updated, ${skipped} rows skipped, ` +
          `$${oldTotal.toFixed(4)} -> $${newTotal.toFixed(4)}.`
      );
    }
  } catch (err) {
    console.error('[DB] Failed to reprice usage_history costs:', err);
  }
}

function backfillGpt55ContextSnapshotWindows(database: Database.Database): void {
  const markerKey = 'session_events_context_window_fix_v1';
  const marker = database.prepare('SELECT value FROM app_config WHERE key = ?').get(markerKey) as
    | { value: string }
    | undefined;
  if (marker?.value === 'gpt-5.5:256000') return;

  const updateRows = database.prepare(
    `
    UPDATE session_events
    SET
      context_window = 256000,
      context_used_percent = ROUND((total_tokens * 100.0) / 256000, 0),
      context_exceeded = CASE
        WHEN ROUND((total_tokens * 100.0) / 256000, 0) > 100 THEN 1
        ELSE 0
      END
    WHERE event_type = 'context_snapshot'
      AND model LIKE 'gpt-5.5%'
      AND context_window = 258400
  `
  );
  const upsertMarker = database.prepare(
    `
    INSERT INTO app_config (key, value, updated_at)
    VALUES (?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
  `
  );

  let updated = 0;
  const tx = database.transaction(() => {
    updated = updateRows.run().changes;
    upsertMarker.run(markerKey, 'gpt-5.5:256000');
  });

  try {
    tx();
    if (updated > 0) {
      console.log(`[DB] Backfilled ${updated} gpt-5.5 context snapshot rows to 256000.`);
    }
  } catch (err) {
    console.error('[DB] Failed to backfill gpt-5.5 context snapshot windows:', err);
  }
}

function initializeBasicAuth(db: Database.Database): void {
  const existingUsername = db
    .prepare('SELECT value FROM app_config WHERE key = ?')
    .get('basic_auth_username') as { value: string } | undefined;

  if (!existingUsername) {
    // Generate a secure random password on first run
    const defaultUsername = 'admin';
    const randomPassword = crypto.randomBytes(16).toString('base64').slice(0, 20);
    const hashedPassword = bcrypt.hashSync(randomPassword, 10);

    db.prepare('INSERT OR IGNORE INTO app_config (key, value) VALUES (?, ?)').run(
      'basic_auth_username',
      defaultUsername
    );
    db.prepare('INSERT OR IGNORE INTO app_config (key, value) VALUES (?, ?)').run(
      'basic_auth_password',
      hashedPassword
    );
    db.prepare('INSERT OR IGNORE INTO app_config (key, value) VALUES (?, ?)').run(
      'basic_auth_enabled',
      'true'
    );

    // Show the generated credentials (only on first run)
    console.log('');
    console.log('╔════════════════════════════════════════════════════════════╗');
    console.log('║  INITIAL BASIC AUTH CREDENTIALS (save these!)              ║');
    console.log('╠════════════════════════════════════════════════════════════╣');
    console.log(`║  Username: ${defaultUsername.padEnd(47)}║`);
    console.log(`║  Password: ${randomPassword.padEnd(47)}║`);
    console.log('╠════════════════════════════════════════════════════════════╣');
    console.log('║  ⚠️  Change these in Settings > Security after first login ║');
    console.log('╚════════════════════════════════════════════════════════════╝');
    console.log('');
  }
}

function backfillEncryptOauthTokens(database: Database.Database): void {
  if (!isEncryptionAvailable()) return;

  const flagRow = database
    .prepare("SELECT value FROM app_config WHERE key = 'oauth_tokens_encrypted_at_rest'")
    .get() as { value: string } | undefined;
  if (flagRow?.value === 'true') return;

  const rows = database
    .prepare(
      'SELECT id, oauth_access_token, oauth_refresh_token FROM ai_providers WHERE oauth_access_token IS NOT NULL OR oauth_refresh_token IS NOT NULL'
    )
    .all() as Array<{
    id: string;
    oauth_access_token: string | null;
    oauth_refresh_token: string | null;
  }>;

  const looksEncrypted = (value: string): boolean => {
    try {
      decrypt(value);
      return true;
    } catch {
      return false;
    }
  };

  const update = database.prepare(
    'UPDATE ai_providers SET oauth_access_token = ?, oauth_refresh_token = ? WHERE id = ?'
  );

  const tx = database.transaction(() => {
    for (const row of rows) {
      const newAccess =
        row.oauth_access_token && !looksEncrypted(row.oauth_access_token)
          ? safeEncrypt(row.oauth_access_token)
          : row.oauth_access_token;
      const newRefresh =
        row.oauth_refresh_token && !looksEncrypted(row.oauth_refresh_token)
          ? safeEncrypt(row.oauth_refresh_token)
          : row.oauth_refresh_token;
      if (newAccess !== row.oauth_access_token || newRefresh !== row.oauth_refresh_token) {
        update.run(newAccess, newRefresh, row.id);
      }
    }
    database
      .prepare(
        "INSERT INTO app_config (key, value, updated_at) VALUES ('oauth_tokens_encrypted_at_rest', 'true', CURRENT_TIMESTAMP) ON CONFLICT(key) DO UPDATE SET value = 'true', updated_at = CURRENT_TIMESTAMP"
      )
      .run();
  });

  try {
    tx();
  } catch (err) {
    console.error('[migrations] Failed to backfill-encrypt OAuth tokens:', err);
  }
}

export function getAppConfig(key: string): string | null {
  const database = getDatabase();
  const row = database.prepare('SELECT value FROM app_config WHERE key = ?').get(key) as
    | { value: string }
    | undefined;
  return row?.value ?? null;
}

export function setAppConfig(key: string, value: string): void {
  const database = getDatabase();
  database
    .prepare(
      `
    INSERT INTO app_config (key, value, updated_at)
    VALUES (?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(key) DO UPDATE SET value = ?, updated_at = CURRENT_TIMESTAMP
  `
    )
    .run(key, value, value);
}

export { db };
