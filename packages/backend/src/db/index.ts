import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import bcrypt from 'bcryptjs';

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
      model TEXT DEFAULT 'claude-sonnet-4-20250514',
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
    CREATE INDEX IF NOT EXISTS idx_messages_session_id ON messages(session_id);
    CREATE INDEX IF NOT EXISTS idx_mcp_servers_user_id ON mcp_servers(user_id);
    CREATE INDEX IF NOT EXISTS idx_cli_tools_user_id ON cli_tools(user_id);
    CREATE INDEX IF NOT EXISTS idx_usage_history_user_id ON usage_history(user_id);
    CREATE INDEX IF NOT EXISTS idx_usage_history_session_id ON usage_history(session_id);
    CREATE INDEX IF NOT EXISTS idx_usage_history_created_at ON usage_history(created_at);
    CREATE INDEX IF NOT EXISTS idx_session_checkpoints_session_id ON session_checkpoints(session_id);
    CREATE INDEX IF NOT EXISTS idx_custom_agents_user_id ON custom_agents(user_id);
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
  `);

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
}

function initializeBasicAuth(db: Database.Database): void {
  const existingUsername = db.prepare('SELECT value FROM app_config WHERE key = ?').get('basic_auth_username') as { value: string } | undefined;

  if (!existingUsername) {
    // Generate a secure random password on first run
    const defaultUsername = 'admin';
    const randomPassword = crypto.randomBytes(16).toString('base64').slice(0, 20);
    const hashedPassword = bcrypt.hashSync(randomPassword, 10);

    db.prepare('INSERT OR IGNORE INTO app_config (key, value) VALUES (?, ?)').run('basic_auth_username', defaultUsername);
    db.prepare('INSERT OR IGNORE INTO app_config (key, value) VALUES (?, ?)').run('basic_auth_password', hashedPassword);
    db.prepare('INSERT OR IGNORE INTO app_config (key, value) VALUES (?, ?)').run('basic_auth_enabled', 'true');

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

export function getAppConfig(key: string): string | null {
  const database = getDatabase();
  const row = database.prepare('SELECT value FROM app_config WHERE key = ?').get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

export function setAppConfig(key: string, value: string): void {
  const database = getDatabase();
  database.prepare(`
    INSERT INTO app_config (key, value, updated_at)
    VALUES (?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(key) DO UPDATE SET value = ?, updated_at = CURRENT_TIMESTAMP
  `).run(key, value, value);
}

export { db };
