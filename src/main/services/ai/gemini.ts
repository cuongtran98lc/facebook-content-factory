import type { AIProvider, GenerateTextOptions } from './types'

interface GeminiResponse {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> }
  }>
  error?: { message?: string }
}

export class GeminiProvider implements AIProvider {
  readonly name = 'gemini' as const

  constructor(private readonly apiKey: string, private readonly model: string) {}

  async generateText(options: GenerateTextOptions): Promise<string> {
    const body: Record<string, unknown> = {
      contents: [{ role: 'user', parts: [{ text: options.prompt }] }]
    }

    if (options.system) {
      body.systemInstruction = { parts: [{ text: options.system }] }
    }
    if (options.json) {
      body.generationConfig = { responseMimeType: 'application/json' }
    }

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(this.model)}:generateContent`
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': this.apiKey
      },
      body: JSON.stringify(body)
    })
    const data = (await response.json()) as GeminiResponse
    if (!response.ok) throw new Error(data.error?.message || `Gemini HTTP ${response.status}`)

    const text = data.candidates?.[0]?.content?.parts?.map((part) => part.text ?? '').join('').trim()
    if (!text) throw new Error('Gemini trả về response nhưng không có text output.')
    return text
  }
}
