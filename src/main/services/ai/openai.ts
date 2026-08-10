import type { AIProvider, GenerateTextOptions } from './types'

interface OpenAIResponse {
  output_text?: string
  output?: Array<{
    content?: Array<{ type?: string; text?: string }>
  }>
  error?: { message?: string }
}

export class OpenAIProvider implements AIProvider {
  readonly name = 'openai' as const

  constructor(private readonly apiKey: string, private readonly model: string) {}

  async generateText(options: GenerateTextOptions): Promise<string> {
    const input = options.system
      ? [{ role: 'system', content: options.system }, { role: 'user', content: options.prompt }]
      : options.prompt

    const body: Record<string, unknown> = { model: this.model, input }
    if (options.json) {
      body.text = { format: { type: 'json_object' } }
    }

    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    })

    const data = (await response.json()) as OpenAIResponse
    if (!response.ok) throw new Error(data.error?.message || `OpenAI HTTP ${response.status}`)

    if (data.output_text?.trim()) return data.output_text.trim()
    const text = data.output
      ?.flatMap((item) => item.content ?? [])
      .map((item) => item.text ?? '')
      .join('')
      .trim()
    if (!text) throw new Error('OpenAI trả về response nhưng không có text output.')
    return text
  }
}
