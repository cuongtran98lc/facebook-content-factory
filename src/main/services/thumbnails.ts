import type { AIProviderName } from '../../shared/types';
import { SettingsService } from './settings';

type GeneratedImage = { bytes: Buffer; mimeType: string; model: string; provider: AIProviderName };

type ErrorResponse = { error?: { message?: string } };

function findGeminiImage(value: unknown): { data: string; mimeType: string } | null {
  if (!value || typeof value !== 'object') return null;
  const item = value as Record<string, unknown>;
  const data = typeof item.data === 'string' ? item.data : null;
  const mimeType =
    typeof item.mime_type === 'string' ? item.mime_type : typeof item.mimeType === 'string' ? item.mimeType : null;
  if (data && (item.type === 'image' || mimeType?.startsWith('image/'))) {
    return { data, mimeType: mimeType ?? 'image/png' };
  }
  for (const child of Object.values(item)) {
    if (Array.isArray(child)) {
      for (const entry of child) {
        const found = findGeminiImage(entry);
        if (found) return found;
      }
    } else {
      const found = findGeminiImage(child);
      if (found) return found;
    }
  }
  return null;
}

export class ThumbnailService {
  constructor(private readonly settings = new SettingsService()) {}

  async generate(prompt: string): Promise<GeneratedImage> {
    const provider = this.settings.getProvider();
    if (provider === 'openai') return this.generateOpenAI(prompt);
    try {
      return await this.generateGemini(prompt);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // "denied access" là lỗi 403 thật của Google (bug đã xác nhận trên forum
      // Google AI Developers, không sửa được từ phía app) — coi cùng nhóm với
      // quota/rate-limit vì hướng xử lý giống nhau: fallback sang OpenAI Images
      // nếu có key, không thì báo rõ để user tự quyết định thay vì lỗi Gemini khó hiểu.
      const geminiUnavailable = /quota|rate.?limit|resource.?exhausted|denied access/i.test(message);
      if (geminiUnavailable && this.settings.getAI().hasOpenAIKey) return this.generateOpenAI(prompt);
      if (geminiUnavailable) {
        throw new Error(
          'Gemini Image hiện không dùng được (quota hết hoặc project bị Google từ chối truy cập — lỗi phía Google, không phải app). Thêm OpenAI API key trong Settings để app tự chuyển sang OpenAI Images.',
        );
      }
      throw error;
    }
  }

  private async generateOpenAI(prompt: string): Promise<GeneratedImage> {
    const model = 'dall-e-3';
    const response = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.settings.getApiKey('openai')}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ model, prompt, size: '1792x1024', response_format: 'b64_json', quality: 'standard' }),
    });
    const data = (await response.json()) as ErrorResponse & { data?: Array<{ b64_json?: string; url?: string }> };
    if (!response.ok) throw new Error(data.error?.message || `OpenAI Images HTTP ${response.status}`);
    const encoded = data.data?.[0]?.b64_json;
    if (encoded) {
      return { bytes: Buffer.from(encoded, 'base64'), mimeType: 'image/png', model, provider: 'openai' };
    }
    const imageUrl = data.data?.[0]?.url;
    if (imageUrl) {
      const imgRes = await fetch(imageUrl);
      if (!imgRes.ok) throw new Error(`Không thể tải ảnh thumbnail từ OpenAI URL (${imgRes.status})`);
      const arrayBuffer = await imgRes.arrayBuffer();
      return { bytes: Buffer.from(arrayBuffer), mimeType: 'image/png', model, provider: 'openai' };
    }
    throw new Error('OpenAI không trả về dữ liệu thumbnail.');
  }

  private async generateGemini(prompt: string): Promise<GeneratedImage> {
    const model = 'gemini-3.1-flash-image';
    const response = await fetch('https://generativelanguage.googleapis.com/v1beta/interactions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': this.settings.getApiKey('gemini'),
      },
      body: JSON.stringify({
        model,
        input: prompt,
        response_format: { type: 'image', mime_type: 'image/jpeg', aspect_ratio: '16:9', image_size: '1K' },
      }),
    });
    const data = (await response.json()) as ErrorResponse & Record<string, unknown>;
    if (!response.ok) throw new Error(data.error?.message || `Gemini Image HTTP ${response.status}`);
    const image = findGeminiImage(data);
    if (!image) throw new Error('Gemini không trả về dữ liệu thumbnail.');
    return { bytes: Buffer.from(image.data, 'base64'), mimeType: image.mimeType, model, provider: 'gemini' };
  }
}
