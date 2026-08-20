import type { AIProvider, GenerateTextOptions } from './types'

// Groq dùng đúng format "chat completions" cổ điển của OpenAI (không phải
// Responses API mới mà OpenAIProvider đang dùng) — messages[] + choices[0].
// https://console.groq.com/docs/api-reference
interface GroqResponse {
  choices?: Array<{ message?: { content?: string } }>
  error?: { message?: string }
}

export class GroqProvider implements AIProvider {
  readonly name = 'groq' as const

  constructor(private readonly apiKey: string, private readonly model: string) {}

  async generateText(options: GenerateTextOptions): Promise<string> {
    const messages: Array<{ role: string; content: string }> = []
    if (options.system) messages.push({ role: 'system', content: options.system })
    messages.push({ role: 'user', content: options.prompt })

    const body: Record<string, unknown> = { model: this.model, messages }
    if (options.json) {
      body.response_format = { type: 'json_object' }
    }

    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    })

    const data = (await response.json()) as GroqResponse
    if (!response.ok) throw new Error(data.error?.message || `Groq HTTP ${response.status}`)

    const text = data.choices?.[0]?.message?.content?.trim()
    if (!text) throw new Error('Groq trả về response nhưng không có text output.')
    return text
  }
}
