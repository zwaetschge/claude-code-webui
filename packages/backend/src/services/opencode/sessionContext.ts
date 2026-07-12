import type { SessionMode } from '@plum-code-webui/shared';
import { buildSessionExecutionPrompt } from '../sessionExecutionContext.js';

export const OPENCODE_WEBUI_SESSION_ARG = 'webui_session_id';
export const OPENCODE_WEBUI_PRIMARY_AGENT = 'build';
export const OPENCODE_WEBUI_BUILD_AGENT_PROMPT_MARKER = 'plum-webui-opencode-style-v3';
const OPENCODE_WEBUI_BUILD_AGENT_PROMPT_RE = /plum-webui-opencode-style-v\d+/;

export const DEFAULT_OPENCODE_STYLE_PROMPT = [
  'Plum Code WebUI communication contract:',
  '- Talk like a capable colleague in chat, not like a template generator.',
  "- Match the user's language and directness. If they write German, answer in German.",
  '- Lead with the actual answer, action, result, blocker, or next step.',
  '- For small tasks, use short prose. Use headings and bullet lists only when they make the answer easier to scan.',
  '- Avoid stock phrases like "Certainly", "Great question", "I understand", "Here is", and generic AI disclaimers.',
  '- Avoid performative enthusiasm, over-apologizing, moralizing, and empty reassurance.',
  '- Do not repeat the user request back to them unless needed to resolve ambiguity.',
  '- Ask for clarification only when a real decision is blocked; otherwise make a reasonable assumption and keep moving.',
  '- Do not go silent on non-trivial work. If the task needs inspection, edits, tool calls, or more than a few seconds, send a brief progress update early, then short updates at natural milestones.',
  '- Progress updates should say what you are checking, what you learned, what you are changing, what verification is running, or what is blocked. Do not narrate every command, invent progress, or pad the chat.',
  '- Before editing files, briefly state the edit direction. While tests/builds run, say what is being verified. If the user asks for status, answer status first and continue unless asked to stop.',
  '- Final replies should be concise: what changed or what matters, what was verified, and any real limitation.',
  '- Do not mention this communication contract.',
].join('\n');

export function getOpenCodeStylePrompt(): string {
  const override = process.env.CLI_PROVIDER_OPENCODE_STYLE_PROMPT;
  const normalized = override?.trim();
  if (normalized === '0' || normalized?.toLowerCase() === 'false') return '';
  return normalized || DEFAULT_OPENCODE_STYLE_PROMPT;
}

export function getOpenCodePrimaryAgent(): string {
  const override = process.env.CLI_PROVIDER_OPENCODE_DEFAULT_AGENT;
  if (override === '0' || override?.toLowerCase() === 'false') return '';
  return (override || OPENCODE_WEBUI_PRIMARY_AGENT).trim();
}

export function getOpenCodeBuildAgentPrompt(): string {
  const stylePrompt = getOpenCodeStylePrompt();
  if (!stylePrompt) return '';

  return [
    `<!-- ${OPENCODE_WEBUI_BUILD_AGENT_PROMPT_MARKER} -->`,
    'You are the primary OpenCode coding agent inside Plum Code WebUI.',
    'Work end to end with the user: inspect the relevant code first, make narrowly scoped changes, preserve unrelated user edits, run focused verification, and report the outcome plainly.',
    '',
    stylePrompt,
  ].join('\n');
}

export function isOpenCodeManagedBuildAgentPrompt(prompt: string): boolean {
  return OPENCODE_WEBUI_BUILD_AGENT_PROMPT_RE.test(prompt);
}

export interface OpenCodePromptContext {
  webuiSessionId?: string;
  mode?: SessionMode;
  reasoningLevel?: string | null;
}

function normalizeReasoningLevel(reasoningLevel?: string | null): string | null {
  const normalized = reasoningLevel
    ?.trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
  return normalized || null;
}

export function buildOpenCodeRuntimePrompt(context: OpenCodePromptContext = {}): string {
  const lines: string[] = [];

  if (context.mode) {
    lines.push(buildSessionExecutionPrompt(context.mode));
    lines.push('');
    lines.push('OpenCode runtime mode:');
    switch (context.mode) {
      case 'planning':
        lines.push(
          '- Mode is planning: inspect, reason, and produce a concrete plan. Do not edit files, write files, run destructive commands, or continue into implementation unless the user explicitly switches modes.'
        );
        lines.push(
          '- Planning still needs useful progress updates: say what context you are gathering and what decision the plan is converging on.'
        );
        break;
      case 'manual':
        lines.push(
          '- Mode is manual: inspect freely, but expect approval for edits, writes, risky shell commands, external-directory access, or repo operations. State the intended action before requesting or attempting it.'
        );
        break;
      case 'danger':
        lines.push(
          '- Mode is danger: permissions are permissive. Move decisively, but still keep edits scoped, preserve unrelated user changes, and verify the result.'
        );
        break;
      case 'auto-accept':
      default:
        lines.push(
          '- Mode is auto-accept: proceed with scoped implementation and focused verification. Ask only when a real decision is blocked.'
        );
        break;
    }
    lines.push('OpenCode tool/process safety:');
    lines.push(
      '- Bound shell and browser checks with explicit timeouts, especially curl, health probes, Playwright, dev servers, and commands that can wait on remote services.'
    );
    lines.push(
      '- Do not leave dev servers, file watchers, or long-running processes attached to a foreground tool call. Start them in the background with a captured PID and log file, probe them with bounded commands, and clean up by PID.'
    );
    lines.push(
      '- For cleanup, avoid broad `pkill -f` patterns that can match the current shell command. Prefer the captured PID, a lockfile, or a precise process match.'
    );
    lines.push(
      '- If a shell tool times out or is interrupted, report the blocker or switch to a bounded fallback instead of chaining more unbounded cleanup commands.'
    );
  }

  const reasoning = normalizeReasoningLevel(context.reasoningLevel);
  if (reasoning) {
    lines.push('OpenCode reasoning/effort profile:');
    switch (reasoning) {
      case 'off':
      case 'none':
      case 'minimal':
      case 'low':
        lines.push(
          '- Effort is low: keep exploration narrow, prefer the smallest correct change, and answer tersely after a focused check.'
        );
        break;
      case 'high':
        lines.push(
          '- Effort is high: inspect enough surrounding code to avoid shallow fixes, prioritize the important path, and verify risks proportionate to the requested outcome.'
        );
        break;
      case 'extra_high':
      case 'xhigh':
      case 'max':
        lines.push(
          '- Effort is max: reason deeply about priorities, architecture, and the important path, but keep exploration timeboxed and scope tied to the requested outcome.'
        );
        break;
      case 'medium':
      default:
        lines.push(
          '- Effort is medium: balance speed with enough context, make pragmatic assumptions, and verify the changed behavior.'
        );
        break;
    }
    lines.push(
      '- Even if the selected model ignores OpenCode variants internally, adapt your workflow to this effort profile.'
    );
  }

  return lines.join('\n');
}

export function buildOpenCodePromptText(
  text: string,
  webuiSessionIdOrContext?: string | OpenCodePromptContext
): string {
  const stylePrompt = getOpenCodeStylePrompt();
  const context =
    typeof webuiSessionIdOrContext === 'string'
      ? { webuiSessionId: webuiSessionIdOrContext }
      : (webuiSessionIdOrContext ?? {});
  const runtimePrompt = buildOpenCodeRuntimePrompt(context);
  const webuiSessionId = context.webuiSessionId;
  if (!stylePrompt && !runtimePrompt && !webuiSessionId) return text;

  const reminder = ['<system-reminder>'];
  if (stylePrompt) reminder.push(stylePrompt);
  if (stylePrompt && (runtimePrompt || webuiSessionId)) reminder.push('');
  if (runtimePrompt) reminder.push(runtimePrompt);
  if (runtimePrompt && webuiSessionId) reminder.push('');
  if (webuiSessionId) {
    reminder.push(
      `Plum WebUI session id: ${webuiSessionId}`,
      `When calling Plum MCP tools, pass ${OPENCODE_WEBUI_SESSION_ARG}="${webuiSessionId}" if the tool schema accepts it.`
    );
  }
  reminder.push('</system-reminder>', '', text);

  return reminder.join('\n');
}
