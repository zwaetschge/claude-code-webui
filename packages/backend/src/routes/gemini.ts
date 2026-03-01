import { Router, Request, Response } from 'express';
import { Server } from 'socket.io';
import { GeminiImageGenerator } from '../services/gemini/ImageGenerator';
import * as path from 'path';
import type {
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData,
} from '@claude-code-webui/shared';

const router = Router();

// Output directory for generated images
const OUTPUT_DIR = path.join(process.cwd(), 'data', 'generated-images');

/**
 * POST /api/gemini/generate-image
 * Generate an image using Gemini API
 * This endpoint can be called by the CLI tool for Claude Code orchestration
 */
router.post('/generate-image', async (req: Request, res: Response) => {
  const { sessionId, prompt, model } = req.body;

  if (!prompt) {
    return res.status(400).json({ success: false, error: 'Prompt is required' });
  }

  if (!sessionId) {
    return res.status(400).json({ success: false, error: 'Session ID is required' });
  }

  const io = req.app.get('io') as Server<
    ClientToServerEvents,
    ServerToClientEvents,
    InterServerEvents,
    SocketData
  >;

  // Emit agent status
  io.to(`session:${sessionId}`).emit('session:agent', {
    sessionId,
    agentType: 'gemini-imagen',
    description: `Generating: ${prompt.substring(0, 40)}...`,
    status: 'started',
  });

  try {
    const imageGenerator = new GeminiImageGenerator(OUTPUT_DIR);

    let result;
    if (model === 'imagen') {
      result = await imageGenerator.generateWithImagen(prompt);
    } else {
      result = await imageGenerator.generateImage(prompt);
    }

    // Emit completion status
    io.to(`session:${sessionId}`).emit('session:agent', {
      sessionId,
      agentType: 'gemini-imagen',
      status: result.success ? 'completed' : 'error',
    });

    if (result.success && result.imageBase64) {
      // Emit the generated image to all session subscribers
      io.to(`session:${sessionId}`).emit('session:image', {
        sessionId,
        imagePath: result.imagePath || '',
        imageBase64: result.imageBase64,
        mimeType: result.mimeType || 'image/png',
        prompt,
        generator: 'gemini',
      });

      return res.json({
        success: true,
        imagePath: result.imagePath,
        mimeType: result.mimeType,
        message: 'Image generated and sent to chat',
      });
    }

    return res.json({
      success: false,
      error: result.error || 'Failed to generate image',
    });
  } catch (err) {
    // Emit error status
    io.to(`session:${sessionId}`).emit('session:agent', {
      sessionId,
      agentType: 'gemini-imagen',
      status: 'error',
    });

    console.error('[GEMINI] Image generation error:', err);
    return res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : 'Unknown error',
    });
  }
});

/**
 * GET /api/gemini/status
 * Check Gemini API availability
 */
router.get('/status', async (_req: Request, res: Response) => {
  const hasApiKey = !!process.env.GEMINI_API_KEY;

  res.json({
    available: hasApiKey,
    model: hasApiKey ? 'gemini-3-pro-image-preview' : null,
    message: hasApiKey
      ? 'Gemini API ready for image generation'
      : 'GEMINI_API_KEY not configured',
  });
});

export default router;
