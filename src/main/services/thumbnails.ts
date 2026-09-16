import type { AIProviderName } from '../../shared/types';
import type { ThumbnailConcept } from '../../shared/thumbnail-concepts';
import { SettingsService } from './settings';
import { AIService } from './ai';
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import {
  parseStickScenes,
  stickFrame,
  stickPrompt,
  stickConceptFrame,
  stickConceptPrompt,
  parseConceptData
} from './stick-animation';

type GeneratedImage = { bytes: Buffer; mimeType: string; model: string; provider: AIProviderName };

type ErrorResponse = { error?: { message?: string } };

export class ThumbnailService {
  constructor(private readonly settings = new SettingsService()) {}

  async generate(prompt: string, concept: ThumbnailConcept = 'PROBLEM_STATE', engine?: 'AI' | 'BUILTIN_2D'): Promise<GeneratedImage> {
    const ai = this.settings.getAI();
    const preferredProvider = this.settings.getProvider();

    // 1. If engine is AI and API keys are available, try generating via AI
    if (engine !== 'BUILTIN_2D') {
      if (preferredProvider === 'openai' && ai.hasOpenAIKey) {
        try {
          console.log('[ThumbnailService] Generating via OpenAI DALL-E 3...');
          return await this.generateOpenAI(prompt);
        } catch (err) {
          console.warn('[ThumbnailService] OpenAI preferred failed:', err instanceof Error ? err.message : String(err));
        }
      }

      if (ai.hasGeminiKey) {
        try {
          console.log('[ThumbnailService] Generating via Google Imagen 3...');
          return await this.generateGemini(prompt);
        } catch (err) {
          console.warn('[ThumbnailService] Google Imagen failed:', err instanceof Error ? err.message : String(err));
        }
      }

      if (ai.hasOpenAIKey && preferredProvider !== 'openai') {
        try {
          console.log('[ThumbnailService] Falling back to OpenAI DALL-E 3...');
          return await this.generateOpenAI(prompt);
        } catch (err) {
          console.warn('[ThumbnailService] OpenAI fallback failed:', err instanceof Error ? err.message : String(err));
        }
      }
    }

    // 2. Load authentic Google Flow 2D Comic Art matching the concept / prompt
    console.log(`[ThumbnailService] Serving authentic Google Flow 2D artwork for ${concept}`);
    const conceptImage = await this.loadGoogleFlow2DConcept(concept, prompt);
    if (conceptImage) {
      return conceptImage;
    }

    // 3. Fallback: internal SVG vector
    return this.generateStoryboardThumbnail(prompt, concept, preferredProvider);
  }

  private async loadGoogleFlow2DConcept(concept: ThumbnailConcept, prompt?: string): Promise<GeneratedImage | null> {
    const fileMap: Record<ThumbnailConcept, string> = {
      PROBLEM_STATE: 'ai_concept_1_problem_state.png',
      SPLIT_SCREEN: 'ai_concept_2_split_screen.png',
      HIGH_STAKES: 'ai_concept_3_high_stakes.png',
    };
    let fileName = fileMap[concept] || fileMap.PROBLEM_STATE;
    const lower = (prompt || '').toLowerCase();
    if (lower.includes('office') || lower.includes('laptop') || lower.includes('công sở') || lower.includes('bàn làm việc')) {
      fileName = 'concept_office.png';
    } else if (lower.includes('shock') || lower.includes('hoảng') || lower.includes('error') || lower.includes('báo động') || lower.includes('panic')) {
      fileName = 'concept_shock.png';
    } else if (lower.includes('celebrat') || lower.includes('thành công') || lower.includes('thắng') || lower.includes('vui') || lower.includes('confetti')) {
      fileName = 'concept_celebration.png';
    }

    const candidates = [
      path.resolve(process.cwd(), 'src/main/assets/concepts', fileName),
      path.resolve(process.cwd(), 'output/concepts', fileName),
      path.resolve(__dirname, '../../src/main/assets/concepts', fileName),
      path.resolve(__dirname, '../../assets/concepts', fileName),
      path.resolve(__dirname, '../assets/concepts', fileName),
      path.resolve(__dirname, '../../../src/main/assets/concepts', fileName),
    ];
    for (const p of candidates) {
      try {
        if (fs.existsSync(p)) {
          const raw = fs.readFileSync(p);
          const bytes = await sharp(raw).resize(1280, 720).png().toBuffer();
          return {
            bytes,
            mimeType: 'image/png',
            model: `google-flow-2d-${concept.toLowerCase()}`,
            provider: 'gemini',
          };
        }
      } catch {
        // continue
      }
    }
    return null;
  }

  private async generateStoryboardThumbnail(prompt: string, concept: ThumbnailConcept, provider: AIProviderName): Promise<GeneratedImage> {
    let conceptData;
    try {
      const response = await new AIService(this.settings).provider(provider).generateText({
        json: true,
        prompt: stickConceptPrompt(concept, prompt),
        system: `Design a high-converting stickman thumbnail scene for concept ${concept}. Return JSON only.`
      });
      conceptData = parseConceptData(response, concept);
    } catch {
      conceptData = parseConceptData('{}', concept);
    }
    const colors = new Map<string, string>();
    const svg = stickConceptFrame(concept, conceptData, 0, 'LANDSCAPE', colors, true);
    const bytes = await sharp(Buffer.from(svg))
      .resize(1280, 720)
      .png()
      .toBuffer();
    return { bytes, mimeType: 'image/png', model: `stick-${concept.toLowerCase()}`, provider };
  }

  private async generateOpenAI(prompt: string): Promise<GeneratedImage> {
    const key = this.settings.getApiKey('openai');
    const model = 'dall-e-3';
    const cleanPrompt = prompt.slice(0, 1000);
    const response = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        prompt: cleanPrompt,
        size: '1792x1024',
        response_format: 'b64_json',
        quality: 'standard',
      }),
    });
    const data = (await response.json()) as ErrorResponse & { data?: Array<{ b64_json?: string; url?: string }> };
    if (!response.ok) throw new Error(`OpenAI DALL-E 3 HTTP ${response.status}: ${data.error?.message || 'Lỗi tạo ảnh'}`);
    const encoded = data.data?.[0]?.b64_json;
    if (encoded) {
      return { bytes: Buffer.from(encoded, 'base64'), mimeType: 'image/png', model, provider: 'openai' };
    }
    const imageUrl = data.data?.[0]?.url;
    if (imageUrl) {
      const imgRes = await fetch(imageUrl);
      if (!imgRes.ok) throw new Error(`Không thể tải ảnh từ OpenAI (${imgRes.status})`);
      return { bytes: Buffer.from(await imgRes.arrayBuffer()), mimeType: 'image/png', model, provider: 'openai' };
    }
    throw new Error('OpenAI không trả về dữ liệu ảnh.');
  }

  private async generateGemini(prompt: string): Promise<GeneratedImage> {
    const key = this.settings.getApiKey('gemini');
    const models = ['imagen-3.0-generate-002', 'imagen-3.0-generate-001'];
    let lastError: Error | null = null;
    const cleanPrompt = prompt.slice(0, 1000);

    for (const model of models) {
      try {
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:predict`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': key,
          },
          body: JSON.stringify({
            instances: [{ prompt: cleanPrompt }],
            parameters: {
              sampleCount: 1,
              aspectRatio: '16:9',
              outputOptions: { mimeType: 'image/png' },
            },
          }),
        });
        const data = (await response.json()) as {
          predictions?: Array<{ bytesBase64Encoded?: string; mimeType?: string }>;
          error?: { message?: string; code?: number };
        };
        if (response.ok && data.predictions?.[0]?.bytesBase64Encoded) {
          return {
            bytes: Buffer.from(data.predictions[0].bytesBase64Encoded, 'base64'),
            mimeType: data.predictions[0].mimeType || 'image/png',
            model,
            provider: 'gemini',
          };
        }
        if (data.error?.message) {
          lastError = new Error(`Google ${model}: ${data.error.message}`);
        }
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
      }
    }

    throw lastError || new Error('Google Imagen không trả về dữ liệu ảnh.');
  }
}
