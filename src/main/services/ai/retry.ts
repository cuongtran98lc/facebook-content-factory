import type { AIProvider, GenerateTextOptions } from './types'

export class AIRequestError extends Error {
  constructor(message: string, readonly status: number, readonly retryAfterMs?: number) {
    super(message)
    this.name = 'AIRequestError'
  }
}

export function retryAfterMs(value: string | null): number | undefined {
  if (!value) return undefined
  const seconds = Number(value)
  const delay = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(value) - Date.now()
  return Number.isFinite(delay) ? Math.max(0, delay) : undefined
}

export function isTemporaryAIError(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  // Quota, billing and credentials need user action, not repeated requests.
  if (/insufficient_quota|quota|billing|payment|api.?key|unauthori[sz]ed|permission denied/i.test(error.message)) return false
  if (error instanceof AIRequestError) return [429, 502, 503, 504].includes(error.status)
  return /high demand|overloaded|over capacity|temporarily unavailable|service unavailable|too many requests|rate.?limit|HTTP\s+(429|502|503|504)\b/i.test(error.message)
}

export class RetryingAIProvider implements AIProvider {
  readonly name: AIProvider['name']

  constructor(
    private readonly delegate: AIProvider,
    private readonly sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms)),
    private readonly random = Math.random,
  ) {
    this.name = delegate.name
  }

  async generateText(options: GenerateTextOptions): Promise<string> {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await this.delegate.generateText(options)
      } catch (error) {
        if (!isTemporaryAIError(error)) throw error
        const serverDelay = error instanceof AIRequestError ? error.retryAfterMs : undefined
        if (attempt === 2 || (serverDelay !== undefined && serverDelay > 60_000)) {
          const guidance = this.name.endsWith('-cli')
            ? 'Hãy đợi rồi thử lại, đổi model trong CLI đang dùng, hoặc đổi CLI tại mục AI sử dụng.'
            : 'Hãy đợi rồi thử lại, hoặc chọn CLI/model khác tại mục AI sử dụng.'
          throw new Error(`AI (${this.name}) đang quá tải hoặc giới hạn tốc độ. Chưa tạo được nội dung sau ${attempt + 1} lần gọi. ${guidance}`, { cause: error })
        }
        const delay = Math.max(serverDelay ?? 0, 2000 * 2 ** attempt + Math.floor(this.random() * 1000))
        await this.sleep(delay)
      }
    }
    throw new Error('Không thể hoàn tất yêu cầu AI.')
  }
}
