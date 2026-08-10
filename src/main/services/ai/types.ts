import type { AIProviderName } from '../../../shared/types'

export interface GenerateTextOptions {
  system?: string
  prompt: string
  json?: boolean
}

export interface AIProvider {
  readonly name: AIProviderName
  generateText(options: GenerateTextOptions): Promise<string>
}
