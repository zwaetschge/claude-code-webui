#!/usr/bin/env node
/**
 * CLI tool for generating images via Gemini API
 * Called by Claude Code to orchestrate image generation
 *
 * Usage: npx tsx generate-image.ts "prompt" --session <sessionId>
 *
 * The tool calls the backend API which:
 * 1. Generates the image using Gemini API
 * 2. Emits the image via WebSocket to the chat
 * 3. Returns success/error status
 */

interface GenerateResult {
  success: boolean;
  imagePath?: string;
  mimeType?: string;
  message?: string;
  error?: string;
}

async function generateImage(prompt: string, sessionId: string): Promise<GenerateResult> {
  // Backend API URL (running in same container)
  const apiUrl = process.env.BACKEND_URL || 'http://localhost:3006';

  try {
    console.log(`[GENERATE-IMAGE] Requesting image: "${prompt.substring(0, 50)}..."`);
    console.log(`[GENERATE-IMAGE] Session: ${sessionId}`);

    const response = await fetch(`${apiUrl}/api/gemini/generate-image`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        prompt,
        sessionId,
        model: 'gemini-3-pro-image-preview',
      }),
    });

    const result = (await response.json()) as GenerateResult;

    if (!response.ok) {
      return {
        success: false,
        error: result.error || `API error ${response.status}`,
      };
    }

    return result;
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Unknown error',
    };
  }
}

// Parse command line arguments
function parseArgs(): { prompt: string; sessionId: string } | null {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.log('Usage: generate-image "prompt" [--session <sessionId>]');
    console.log('');
    console.log('Options:');
    console.log('  --session <id>   Session ID (defaults to WEBUI_SESSION_ID env var)');
    console.log('');
    console.log('Example:');
    console.log('  generate-image "A sunset over mountains"');
    console.log('  generate-image "A sunset over mountains" --session abc123');
    return null;
  }

  let prompt = '';
  let sessionId = process.env.WEBUI_SESSION_ID || '';

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const nextArg = args[i + 1];
    if (arg === '--session' && nextArg) {
      sessionId = nextArg;
      i++; // Skip next arg
    } else if (arg && !arg.startsWith('--')) {
      prompt = arg;
    }
  }

  if (!prompt) {
    console.error('Error: Prompt is required');
    return null;
  }

  if (!sessionId) {
    console.error('Error: Session ID required. Use --session or set WEBUI_SESSION_ID');
    return null;
  }

  return { prompt, sessionId };
}

// Main
const parsed = parseArgs();
if (!parsed) {
  process.exit(1);
}

const { prompt, sessionId } = parsed;

console.log(`[GENERATE-IMAGE] Starting generation...`);
console.log(`[GENERATE-IMAGE] Prompt: "${prompt}"`);

generateImage(prompt, sessionId).then((result) => {
  if (result.success) {
    console.log(`[GENERATE-IMAGE] Success!`);
    console.log(`[GENERATE-IMAGE] Image path: ${result.imagePath}`);
    console.log(`[GENERATE-IMAGE] ${result.message || 'Image sent to chat'}`);
    // Output JSON for machine parsing
    console.log(JSON.stringify({ success: true, imagePath: result.imagePath }));
  } else {
    console.error(`[GENERATE-IMAGE] Error: ${result.error}`);
    console.log(JSON.stringify({ success: false, error: result.error }));
    process.exit(1);
  }
});
