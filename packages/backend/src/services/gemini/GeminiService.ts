import { spawn } from 'child_process';
import { Server } from 'socket.io';
import * as fs from 'fs';
import * as path from 'path';
import {
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData,
} from '@claude-code-webui/shared';
import { GeminiImageGenerator } from './ImageGenerator';
import { getGeminiApiKeyForUser } from '../../routes/settings';

interface GeminiImageResult {
  success: boolean;
  imagePath?: string;
  imageBase64?: string;
  mimeType?: string;
  error?: string;
}

export class GeminiService {
  private io: Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;
  private outputDir: string;

  constructor(
    io: Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>
  ) {
    this.io = io;
    this.outputDir = path.join(process.cwd(), 'data', 'generated-images');

    // Ensure output directory exists
    if (!fs.existsSync(this.outputDir)) {
      fs.mkdirSync(this.outputDir, { recursive: true });
    }
  }

  /**
   * Get image generator with user's API key
   */
  private getImageGenerator(userId?: string): GeminiImageGenerator {
    // Try to get user-specific API key from database
    let apiKey: string | undefined;
    if (userId) {
      apiKey = getGeminiApiKeyForUser(userId) || undefined;
    }
    return new GeminiImageGenerator(this.outputDir, apiKey);
  }

  /**
   * Generate an image using Gemini API (with OAuth or API key)
   */
  async generateImage(
    sessionId: string,
    prompt: string,
    options: {
      model?: 'gemini-2.5-flash-image' | 'gemini-3-pro-image-preview' | 'imagen';
      referenceImages?: string[];
      userId?: string;
    } = {}
  ): Promise<GeminiImageResult> {
    // Emit status update
    this.io.to(`session:${sessionId}`).emit('session:agent', {
      sessionId,
      agentType: 'gemini-imagen',
      description: `Generating image: ${prompt.substring(0, 50)}...`,
      status: 'started',
    });

    try {
      // Get image generator with user's API key
      const imageGenerator = this.getImageGenerator(options.userId);
      let result: GeminiImageResult;

      // Use Imagen if specifically requested and API key available
      if (options.model === 'imagen' && imageGenerator.hasApiKey()) {
        result = await imageGenerator.generateWithImagen(prompt);
      } else {
        // Use Gemini Flash Image (works with OAuth or API key)
        result = await imageGenerator.generateImage(prompt);
      }

      // Emit completion
      this.io.to(`session:${sessionId}`).emit('session:agent', {
        sessionId,
        agentType: 'gemini-imagen',
        status: result.success ? 'completed' : 'error',
      });

      return result;
    } catch (error) {
      // Emit error
      this.io.to(`session:${sessionId}`).emit('session:agent', {
        sessionId,
        agentType: 'gemini-imagen',
        status: 'error',
      });

      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Check if Gemini CLI is available
   */
  async checkAvailability(): Promise<{ available: boolean; version?: string; error?: string }> {
    return new Promise((resolve) => {
      const proc = spawn('gemini', ['--version'], {
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      let version = '';

      proc.stdout?.on('data', (data) => {
        version += data.toString();
      });

      proc.on('close', (code) => {
        if (code === 0) {
          resolve({ available: true, version: version.trim() });
        } else {
          resolve({ available: false, error: 'Gemini CLI not found' });
        }
      });

      proc.on('error', () => {
        resolve({
          available: false,
          error: 'Gemini CLI not installed. Run: npm install -g @google/gemini-cli'
        });
      });
    });
  }
}
