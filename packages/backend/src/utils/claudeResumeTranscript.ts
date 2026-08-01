import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';

const ANTHROPIC_SERVER_TOOL_ID = /^srvtoolu_[a-zA-Z0-9_]+$/;
const SAFE_RESUME_ID = /^[a-zA-Z0-9_-]+$/;

interface TranscriptContentBlock {
  type?: unknown;
  id?: unknown;
  name?: unknown;
  [key: string]: unknown;
}

interface TranscriptEntry {
  message?: {
    content?: unknown;
    stop_reason?: unknown;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export interface ClaudeResumeTranscriptSanitizeResult {
  updated: boolean;
  replacements: number;
  transcriptPath: string;
  backupPath: string | null;
}

function claudeProjectDirectoryName(workingDirectory: string): string {
  return path.resolve(workingDirectory).replace(/[^a-zA-Z0-9]/g, '-');
}

function safeToolName(value: unknown): string {
  if (typeof value !== 'string') return 'unknown';
  const compact = value.replace(/[^a-zA-Z0-9_.-]/g, '').slice(0, 80);
  return compact || 'unknown';
}

/**
 * Claude Code persists native resume transcripts under ~/.claude/projects.
 * Older Plum installs could accidentally run a displayed Claude session through
 * Z.AI. Z.AI then wrote `server_tool_use` blocks with `call_*` ids, while the
 * Anthropic API only accepts `srvtoolu_*`. Preserve the transcript chain and
 * its text/tool results, but replace only those incompatible provider-owned
 * blocks before a real Anthropic resume.
 */
export async function sanitizeClaudeResumeTranscript(
  configHome: string,
  workingDirectory: string,
  resumeId: string
): Promise<ClaudeResumeTranscriptSanitizeResult> {
  if (!SAFE_RESUME_ID.test(resumeId)) {
    throw new Error('Invalid Claude resume id');
  }

  const transcriptPath = path.join(
    configHome,
    'projects',
    claudeProjectDirectoryName(workingDirectory),
    `${resumeId}.jsonl`
  );
  let raw: string;
  try {
    raw = await fs.readFile(transcriptPath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { updated: false, replacements: 0, transcriptPath, backupPath: null };
    }
    throw error;
  }

  let replacements = 0;
  const trailingNewline = raw.endsWith('\n');
  const lines = raw.split('\n');
  const rewritten = lines.map((line) => {
    if (!line.trim()) return line;

    let entry: TranscriptEntry;
    try {
      entry = JSON.parse(line) as TranscriptEntry;
    } catch {
      return line;
    }

    if (!Array.isArray(entry.message?.content)) return line;
    let lineUpdated = false;
    const content = (entry.message.content as TranscriptContentBlock[]).map((block) => {
      if (
        block?.type !== 'server_tool_use' ||
        (typeof block.id === 'string' && ANTHROPIC_SERVER_TOOL_ID.test(block.id))
      ) {
        return block;
      }

      lineUpdated = true;
      replacements += 1;
      return {
        type: 'text',
        text: `[Legacy Z.AI server tool call omitted during Anthropic resume: ${safeToolName(block.name)}. Its result remains in the following transcript text.]`,
      };
    });

    if (!lineUpdated) return line;
    entry.message.content = content;
    if (
      entry.message.stop_reason === 'tool_use' &&
      !content.some((block) => block.type === 'tool_use' || block.type === 'server_tool_use')
    ) {
      entry.message.stop_reason = 'end_turn';
    }
    return JSON.stringify(entry);
  });

  if (replacements === 0) {
    return { updated: false, replacements, transcriptPath, backupPath: null };
  }

  const backupPath = `${transcriptPath}.pre-anthropic-resume.bak`;
  try {
    await fs.copyFile(transcriptPath, backupPath, constants.COPYFILE_EXCL);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
  }

  const stat = await fs.stat(transcriptPath);
  const temporaryPath = `${transcriptPath}.${process.pid}.${Date.now()}.tmp`;
  const output =
    rewritten.join('\n') +
    (trailingNewline && !rewritten.at(-1) ? '' : trailingNewline ? '\n' : '');
  try {
    await fs.writeFile(temporaryPath, output, { mode: stat.mode });
    await fs.rename(temporaryPath, transcriptPath);
  } catch (error) {
    await fs.rm(temporaryPath, { force: true });
    throw error;
  }

  return { updated: true, replacements, transcriptPath, backupPath };
}
