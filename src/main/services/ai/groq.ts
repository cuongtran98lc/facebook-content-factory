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

    let promptContent = options.prompt
    if (options.json && !promptContent.toLowerCase().includes('json')) {
      promptContent += '\n\nPlease return strictly valid JSON format.'
    }
    messages.push({ role: 'user', content: promptContent })

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
    if (!response.ok) {
      // If Groq's server-side JSON mode validator fails ("Failed to validate JSON"), retry without response_format constraint
      if (options.json && data.error?.message?.includes('Failed to validate JSON')) {
        delete body.response_format
        const retryRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(body)
        })
        const retryData = (await retryRes.json()) as GroqResponse
        if (retryRes.ok && retryData.choices?.[0]?.message?.content?.trim()) {
          return retryData.choices[0].message.content.trim()
        }
        throw new Error(retryData.error?.message || data.error?.message || `Groq HTTP ${retryRes.status}`)
      }
      throw new Error(data.error?.message || `Groq HTTP ${response.status}`)
    }

    const text = data.choices?.[0]?.message?.content?.trim()
    if (!text) throw new Error('Groq trả về response nhưng không có text output.')
    return text
  }
}
