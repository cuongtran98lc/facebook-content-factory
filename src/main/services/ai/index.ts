import type { AIProviderName } from '../../../shared/types';
import { SettingsService } from '../settings';
import { GeminiProvider } from './gemini';
import { GroqProvider } from './groq';
import { OpenAIProvider } from './openai';
import type { AIProvider } from './types';

export class AIService {
  constructor(private readonly settings = new SettingsService()) {}

  provider(providerName?: AIProviderName): AIProvider {
    const name = providerName ?? this.settings.getProvider();
    const key = this.settings.getApiKey(name);
    const model = this.settings.getModel(name);
    if (name === 'openai') return new OpenAIProvider(key, model);
    if (name === 'groq') return new GroqProvider(key, model);
    return new GeminiProvider(key, model);
  }

  async test(providerName?: AIProviderName): Promise<{ ok: boolean; provider: AIProviderName; message: string }> {
    const provider = this.provider(providerName);
    const result = await provider.generateText({ prompt: 'Reply with exactly: OK' });
    return { ok: /ok/i.test(result), provider: provider.name, message: result.slice(0, 160) };
  }
}
