import Database from 'better-sqlite3';
import fs from 'fs';
import os from 'os';
import path from 'path';

function readSourceArgument(): string | null {
  const index = process.argv.indexOf('--source');
  if (index === -1) return null;

  const value = process.argv[index + 1];
  if (!value) throw new Error('--source requires a SQLite database path');
  return path.resolve(value);
}

const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'plum-migration-'));
const targetDatabase = path.join(temporaryDirectory, 'claude-webui.db');

try {
  const sourceDatabase = readSourceArgument();
  if (sourceDatabase) {
    if (!fs.existsSync(sourceDatabase)) {
      throw new Error(`source database does not exist: ${sourceDatabase}`);
    }

    const source = new Database(sourceDatabase, { readonly: true, fileMustExist: true });
    try {
      await source.backup(targetDatabase);
    } finally {
      source.close();
    }
  }

  process.env.NODE_ENV = 'test';
  process.env.SESSION_SECRET ||= 'migration-dry-run-session-secret-0000000000000000';
  process.env.JWT_SECRET ||= 'migration-dry-run-jwt-secret-0000000000000000000';
  process.env.ENCRYPTION_KEY ||= 'migration-dry-run-encryption-key-000000000000';
  process.env.WEBUI_DATA_DIR = temporaryDirectory;
  process.env.WEBUI_SUPPRESS_BOOTSTRAP_CREDENTIAL_LOG = '1';

  const { getDatabasePath, initDatabase } = await import('../src/db/index.js');
  const migrated = initDatabase();
  try {
    const quickCheck = migrated.pragma('quick_check') as Array<{ quick_check: string }>;
    if (quickCheck.length !== 1 || quickCheck[0]?.quick_check !== 'ok') {
      throw new Error(`SQLite quick_check failed: ${JSON.stringify(quickCheck)}`);
    }

    const foreignKeyErrors = migrated.pragma('foreign_key_check') as unknown[];
    if (foreignKeyErrors.length > 0) {
      throw new Error(`foreign_key_check failed with ${foreignKeyErrors.length} row(s)`);
    }

    console.log(`Migration dry-run passed: ${getDatabasePath()}`);
  } finally {
    migrated.close();
  }
} finally {
  fs.rmSync(temporaryDirectory, { recursive: true, force: true });
}
