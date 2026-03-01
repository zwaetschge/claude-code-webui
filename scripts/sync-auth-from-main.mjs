/**
 * Syncs auth credentials and sessions from the main WebUI database to the repair bot database.
 * Runs before the repair bot WebUI starts.
 */
import { createRequire } from 'module';
const require = createRequire('/app/packages/backend/node_modules/');

// Resolve better-sqlite3 from the app's node_modules
const Database = require('better-sqlite3');
import { existsSync, mkdirSync } from 'fs';

const MAIN_DB = '/webui/data/claude-webui.db';
const BOT_DB = '/app/packages/backend/data/claude-webui.db';

try {
  if (!existsSync(MAIN_DB)) {
    console.log('[sync-auth] Main DB not found, skipping sync');
    process.exit(0);
  }

  mkdirSync('/app/packages/backend/data', { recursive: true });

  const mainDb = new Database(MAIN_DB, { readonly: true });
  const botDb = new Database(BOT_DB);

  // Ensure app_config table exists
  botDb.exec(`CREATE TABLE IF NOT EXISTS app_config (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  )`);

  // Sync auth credentials
  const AUTH_KEYS = ['basic_auth_username', 'basic_auth_password', 'basic_auth_enabled'];
  const readStmt = mainDb.prepare('SELECT value FROM app_config WHERE key = ?');
  const writeStmt = botDb.prepare('INSERT OR REPLACE INTO app_config (key, value) VALUES (?, ?)');

  let synced = 0;
  for (const key of AUTH_KEYS) {
    const row = readStmt.get(key);
    if (row) {
      writeStmt.run(key, row.value);
      synced++;
    }
  }
  console.log(`[sync-auth] Synced ${synced} auth settings`);

  // Sync sessions and messages so repair bot has full context
  const tables = mainDb.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r => r.name);

  // Sync tables by dropping and recreating with main DB schema
  // Disable FK checks to allow dropping tables in any order
  botDb.pragma('foreign_keys = OFF');
  for (const tableName of ['messages', 'sessions']) {
    if (!tables.includes(tableName)) continue;
    const schema = mainDb.prepare("SELECT sql FROM sqlite_master WHERE name=?").get(tableName);
    if (!schema) continue;

    botDb.exec(`DROP TABLE IF EXISTS ${tableName}`);
    botDb.exec(schema.sql);

    const rows = mainDb.prepare(`SELECT * FROM ${tableName}`).all();
    if (rows.length > 0) {
      const cols = Object.keys(rows[0]);
      const placeholders = cols.map(() => '?').join(',');
      const insert = botDb.prepare(`INSERT OR REPLACE INTO ${tableName} (${cols.join(',')}) VALUES (${placeholders})`);
      const tx = botDb.transaction(() => {
        for (const row of rows) insert.run(...cols.map(c => row[c]));
      });
      tx();
      console.log(`[sync-auth] Synced ${rows.length} ${tableName}`);
    }
  }
  botDb.pragma('foreign_keys = ON');

  mainDb.close();
  botDb.close();
} catch (err) {
  console.error('[sync-auth] Warning:', err.message);
}
