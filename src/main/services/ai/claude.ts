import type { AIProvider, GenerateTextOptions } from './types'

interface ClaudeResponse {
  content?: Array<{ type?: string; text?: string }>
  error?: { message?: string }
}

export class ClaudeProvider implements AIProvider {
  readonly name = 'claude' as const

  constructor(private readonly apiKey: string, private readonly model: string) {}

  async generateText(options: GenerateTextOptions): Promise<string> {
    const prompt = options.json
      ? `${options.prompt}\n\nIMPORTANT: Return ONLY a valid JSON object. Do not wrap in markdown blocks or include any introduction/conclusion.`
      : options.prompt

    const body: Record<string, unknown> = {
      model: this.model,
      max_tokens: 4000,
      messages: [{ role: 'user', content: prompt }]
    }

    if (options.system) {
      body.system = options.system
    }

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify(body)
    })

    const data = (await response.json()) as ClaudeResponse
    if (!response.ok) throw new Error(data.error?.message || `Claude HTTP ${response.status}`)

    const text = data.content
      ?.filter((item) => item.type === 'text')
      .map((item) => item.text ?? '')
      .join('')
      .trim()

    if (!text) throw new Error('Claude trả về response nhưng không có text output.')
    return text
  }
}
