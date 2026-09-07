export const MARKETS = [{ value: 'VN', label: 'Việt Nam' }, { value: 'US', label: 'Mỹ' }, { value: 'GB', label: 'Anh' }] as const
export const LANGUAGES = [{ value: 'vi-VN', label: 'Tiếng Việt' }, { value: 'en-US', label: 'Tiếng Anh (Mỹ)' }, { value: 'en-GB', label: 'Tiếng Anh (Anh)' }] as const
export interface Audience { targetMarket?: string; contentLanguage?: string }
export function audiencePrompt(audience: Audience = {}): string {
  const market = MARKETS.find(item => item.value === (audience.targetMarket ?? 'VN'))
  const language = LANGUAGES.find(item => item.value === (audience.contentLanguage ?? 'vi-VN'))
  if (!market || !language) throw new Error('Thị trường hoặc ngôn ngữ không được hỗ trợ.')
  return `Target YouTube audience: ${market.label} (${market.value}). Output language: ${language.label} (${language.value}). Write all audience-facing titles, hooks, narration and descriptions naturally in this language. Adapt idioms, examples and units to the audience while preserving established story facts and character identities. For new characters choose culturally appropriate proper names. Keep JSON keys, taxonomy category values and role codes unchanged. This language requirement overrides Vietnamese examples in the creative guide.`
}
