import * as fs from 'fs';
import * as path from 'path';

interface ImageGenerationResult {
  success: boolean;
  imagePath?: string;
  imageBase64?: string;
  mimeType?: string;
  error?: string;
}

/**
 * Gemini Image Generator using the Gemini API
 * Supports both API key and OAuth token authentication
 */
// Response type for Gemini API
interface GeminiResponse {
  candidates?: Array<{
    content?: {
      parts?: Array<{
        text?: string;
        inlineData?: {
          data: string;
          mimeType: string;
        };
      }>;
    };
  }>;
}

// Response type for Imagen API
interface ImagenResponse {
  predictions?: Array<{
    bytesBase64Encoded?: string;
    mimeType?: string;
  }>;
}

export class GeminiImageGenerator {
  private outputDir: string;
  private apiKey?: string;

  constructor(outputDir: string, apiKey?: string) {
    this.outputDir = outputDir;
    // Use provided API key, fall back to environment variable
    this.apiKey = apiKey || process.env.GEMINI_API_KEY;

    // Ensure output directory exists
    if (!fs.existsSync(this.outputDir)) {
      fs.mkdirSync(this.outputDir, { recursive: true });
    }
  }

  /**
   * Update the API key (useful when key is loaded from database)
   */
  setApiKey(apiKey: string | undefined): void {
    this.apiKey = apiKey;
  }

  /**
   * Check if an API key is configured
   */
  hasApiKey(): boolean {
    return !!this.apiKey;
  }

  /**
   * Try to load OAuth token from Gemini CLI credentials
   */
  private async loadOAuthToken(): Promise<string | null> {
    const credsPaths = [
      '/home/node/.gemini/oauth_creds.json',
      path.join(process.env.HOME || '', '.gemini', 'oauth_creds.json'),
    ];

    for (const credsPath of credsPaths) {
      try {
        if (fs.existsSync(credsPath)) {
          const creds = JSON.parse(fs.readFileSync(credsPath, 'utf-8'));
          if (creds.access_token) {
            console.log('[GEMINI-IMAGE] Loaded OAuth token from', credsPath);
            return creds.access_token;
          }
        }
      } catch (err) {
        console.error('[GEMINI-IMAGE] Failed to load OAuth creds:', err);
      }
    }
    return null;
  }

  /**
   * Generate an image using Gemini 2.5 Flash Image model
   */
  async generateImage(prompt: string): Promise<ImageGenerationResult> {
    // Try OAuth first, then API key
    let authHeader: string;
    let apiUrl: string;

    if (!this.apiKey) {
      const oauthToken = await this.loadOAuthToken();
      if (oauthToken) {
        authHeader = `Bearer ${oauthToken}`;
        // OAuth uses a different endpoint
        apiUrl = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent';
      } else {
        return {
          success: false,
          error: 'No API key or OAuth token available. Set your Gemini API key in Settings or login with gemini CLI.',
        };
      }
    } else {
      authHeader = '';
      // Use Nano Banana Pro (Gemini 3 Pro Image) for best quality
      apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-pro-image-preview:generateContent?key=${this.apiKey}`;
    }

    try {
      console.log('[GEMINI-IMAGE] Generating image with prompt:', prompt.substring(0, 50));

      const requestBody = {
        contents: [
          {
            parts: [
              {
                text: `Generate an image: ${prompt}. Create a high-quality, detailed image based on this description.`,
              },
            ],
          },
        ],
        generationConfig: {
          responseModalities: ['TEXT', 'IMAGE'],
        },
      };

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };

      if (authHeader) {
        headers['Authorization'] = authHeader;
      }

      const response = await fetch(apiUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('[GEMINI-IMAGE] API error:', response.status, errorText);
        return {
          success: false,
          error: `API error ${response.status}: ${errorText}`,
        };
      }

      const result = (await response.json()) as GeminiResponse;
      console.log('[GEMINI-IMAGE] Response received');

      // Extract image from response
      const candidates = result.candidates || [];
      for (const candidate of candidates) {
        const parts = candidate.content?.parts || [];
        for (const part of parts) {
          if (part.inlineData) {
            const { data, mimeType } = part.inlineData;
            const timestamp = Date.now();
            const ext = mimeType.includes('png') ? 'png' : 'jpg';
            const filename = `gemini-${timestamp}.${ext}`;
            const filepath = path.join(this.outputDir, filename);

            // Save image
            const buffer = Buffer.from(data, 'base64');
            fs.writeFileSync(filepath, buffer);
            console.log('[GEMINI-IMAGE] Saved image to', filepath);

            return {
              success: true,
              imagePath: filepath,
              imageBase64: data,
              mimeType,
            };
          }
        }
      }

      // No image in response - might be text only
      const textContent = candidates[0]?.content?.parts?.[0]?.text;
      return {
        success: false,
        error: textContent || 'No image generated. The model may not support image generation with current settings.',
      };
    } catch (err) {
      console.error('[GEMINI-IMAGE] Error:', err);
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Unknown error',
      };
    }
  }

  /**
   * Generate image using Imagen 3 model (requires API key)
   */
  async generateWithImagen(prompt: string): Promise<ImageGenerationResult> {
    if (!this.apiKey) {
      return {
        success: false,
        error: 'Imagen requires an API key. Set your Gemini API key in Settings.',
      };
    }

    try {
      console.log('[GEMINI-IMAGE] Generating with Imagen:', prompt.substring(0, 50));

      const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/imagen-3.0-generate-002:predict?key=${this.apiKey}`;

      const requestBody = {
        instances: [{ prompt }],
        parameters: {
          sampleCount: 1,
        },
      };

      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        const errorText = await response.text();
        return {
          success: false,
          error: `Imagen API error ${response.status}: ${errorText}`,
        };
      }

      const result = (await response.json()) as ImagenResponse;
      const predictions = result.predictions || [];
      const firstPrediction = predictions[0];

      if (firstPrediction?.bytesBase64Encoded) {
        const data = firstPrediction.bytesBase64Encoded;
        const mimeType = firstPrediction.mimeType || 'image/png';
        const timestamp = Date.now();
        const ext = mimeType.includes('png') ? 'png' : 'jpg';
        const filename = `imagen-${timestamp}.${ext}`;
        const filepath = path.join(this.outputDir, filename);

        const buffer = Buffer.from(data, 'base64');
        fs.writeFileSync(filepath, buffer);
        console.log('[GEMINI-IMAGE] Saved Imagen image to', filepath);

        return {
          success: true,
          imagePath: filepath,
          imageBase64: data,
          mimeType,
        };
      }

      return {
        success: false,
        error: 'No image generated by Imagen',
      };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Unknown error',
      };
    }
  }
}
