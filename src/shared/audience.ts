export const MARKETS = [
  { value: 'US', label: '🇺🇸 United States' },
  { value: 'GB', label: '🇬🇧 United Kingdom' },
  { value: 'CA', label: '🇨🇦 Canada' },
  { value: 'AU', label: '🇦🇺 Australia' },
  { value: 'DE', label: '🇩🇪 Germany' },
  { value: 'VN', label: '🇻🇳 Việt Nam' },
] as const

const MARKET_CONTEXT: Record<typeof MARKETS[number]['value'], string> = {
  US: 'Use a coherent US setting: e.g. apartment roommates, a suburban neighborhood, a campus or a service job. Use US English conventions when writing English, dollars and context-appropriate US units.',
  GB: 'Use a coherent UK setting: e.g. a shared flat, a high street, a commuter train or a local workplace. Use British English when writing English, pounds and context-appropriate UK units; do not transplant US school or workplace conventions.',
  CA: 'Use a coherent Canadian setting: e.g. a shared rental, a neighborhood, a campus or a local workplace. Use Canadian dollars and metric units where appropriate; do not treat Canada as a generic US city.',
  AU: 'Use a coherent Australian setting: e.g. a share house, a suburban commute, a cafe or a local workplace. Use natural Australian English when writing English, Australian dollars, metric units and Southern Hemisphere seasons.',
  DE: 'Use a coherent German setting: e.g. a shared apartment, public transport, a neighborhood or an international workplace. Use euros and metric units. If the selected language is English, target English-speaking residents and international viewers interested in life in Germany; Germany is not an English-majority country. Explain unfamiliar local details through action.',
  VN: 'Use a coherent Vietnamese setting, local everyday details and context-appropriate currency and units.',
}
export const LANGUAGES = [{ value: 'vi-VN', label: 'Tiếng Việt' }, { value: 'en-US', label: 'Tiếng Anh (Mỹ)' }, { value: 'en-GB', label: 'Tiếng Anh (Anh)' }] as const
export interface Audience { targetMarket?: string; contentLanguage?: string }
export function audiencePrompt(audience: Audience = {}): string {
  const market = MARKETS.find(item => item.value === (audience.targetMarket ?? 'VN'))
  const language = LANGUAGES.find(item => item.value === (audience.contentLanguage ?? 'vi-VN'))
  if (!market || !language) throw new Error('Thị trường hoặc ngôn ngữ không được hỗ trợ.')
  return `Target YouTube audience: ${market.label} (${market.value}). Output language: ${language.label} (${language.value}). Write all audience-facing titles, hooks, narration and descriptions naturally in this language. Adapt idioms, examples and units to the audience while preserving established story facts and character identities. For new characters choose culturally appropriate proper names. ${MARKET_CONTEXT[market.value]} These are optional setting examples, not required plots. Ground each new concept in a specific place and believable daily-life details, without national stereotypes, forced slang or mixing unrelated countries' customs. Keep the emotional conflict accessible to international viewers. Keep JSON keys, taxonomy category values and role codes unchanged. This language requirement overrides Vietnamese examples in the creative guide.`
}
