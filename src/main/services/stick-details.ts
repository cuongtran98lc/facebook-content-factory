export const HAIR = ['none', 'short', 'long', 'bun'] as const
export const OUTFITS = ['plain', 'hoodie', 'shirt', 'dress', 'suit', 'uniform'] as const
export const AGES = ['child', 'adult', 'elder'] as const
export const EMOTIONS = ['neutral', 'happy', 'sad', 'angry', 'surprised', 'worried'] as const
export const PROPS = ['none', 'book', 'phone', 'bag', 'letter', 'cup', 'flowers', 'laptop', 'gamepad', 'gift', 'money'] as const
export const OBJECTS = ['table', 'chair', 'bed', 'door', 'plant', 'bookshelf'] as const
export const CHARACTER_ROLES = ['MAIN', 'GIRLFRIEND', 'BEST_FRIEND', 'SUPPORTING'] as const
export const ROLE_COLORS = { MAIN: '#3788e5', GIRLFRIEND: '#ef91b5', BEST_FRIEND: '#f2ca45' } as const
export const ARCHETYPES = ['crush', 'ex', 'stranger', 'rival', 'bully', 'boss', 'coworker', 'teacher', 'student', 'parent', 'sibling', 'neighbor', 'rich', 'poor', 'mentor', 'villain', 'false_villain', 'hidden_hero'] as const
export const TRAITS = ['kind', 'selfish', 'naive', 'smart', 'lazy', 'ambitious', 'greedy', 'loyal', 'jealous', 'shy', 'confident', 'arrogant', 'funny', 'unlucky', 'lucky', 'mysterious', 'patient', 'impulsive'] as const
export interface CharacterDetails {
  archetype?: typeof ARCHETYPES[number]
  trait?: typeof TRAITS[number]
  role?: typeof CHARACTER_ROLES[number]
  hair?: typeof HAIR[number]
  outfit?: typeof OUTFITS[number]
  age?: typeof AGES[number]
  emotion?: typeof EMOTIONS[number]
  prop?: typeof PROPS[number]
  position?: 'left' | 'center' | 'right'
  facing?: 'left' | 'right'
}

function option<T extends string>(value: unknown, allowed: readonly T[], _field: string): T | undefined {
  if (value === undefined || value === null) return undefined
  const str = String(value).trim().toLowerCase()
  const found = allowed.find(item => item.toLowerCase() === str)
  if (found) return found
  return undefined
}
export function parseDetails(actor: Record<string, unknown>): CharacterDetails {
  return {
    archetype: option(actor.archetype, ARCHETYPES, 'archetype'),
    trait: option(actor.trait, TRAITS, 'trait'),
    role: option(actor.role, CHARACTER_ROLES, 'role'),
    hair: option(actor.hair, HAIR, 'hair'), outfit: option(actor.outfit, OUTFITS, 'outfit'),
    age: option(actor.age, AGES, 'age'), emotion: option(actor.emotion, EMOTIONS, 'emotion'),
    prop: option(actor.prop, PROPS, 'prop'),
    position: option(actor.position, ['left', 'center', 'right'], 'position'),
    facing: option(actor.facing, ['left', 'right'], 'facing')
  }
}
export function parseObjects(value: unknown): typeof OBJECTS[number][] | undefined {
  if (!Array.isArray(value)) return undefined
  const valid = value.map(item => option(item, OBJECTS, 'objects')).filter((x): x is typeof OBJECTS[number] => x !== undefined)
  return valid.slice(0, 4)
}

export function characterHair(hair: CharacterDetails['hair'], head: number): string {
  if (hair === 'short') return `<path d="M-55 ${head - 8}Q-48 ${head - 64} 8 ${head - 55}Q53 ${head - 51} 59 ${head - 10}L30 ${head - 31}L12 ${head - 20}L-3 ${head - 35}L-30 ${head - 18}Z" fill="#45413e"/>`
  if (hair === 'long') return `<path d="M-56 ${head + 8}Q-69 ${head - 57} 0 ${head - 57}Q69 ${head - 61} 62 ${head + 48}L43 ${head + 38}Q60 ${head - 20} 15 ${head - 38}Q-5 ${head - 8} -43 ${head - 8}L-39 ${head + 47}L-62 ${head + 43}Z" fill="#55504b"/>`
  if (hair === 'bun') return `<circle cx="43" cy="${head - 54}" r="18" fill="#55504b"/><path d="M-55 ${head - 3}Q-53 ${head - 62} 8 ${head - 55}Q55 ${head - 53} 59 ${head - 4}Q26 ${head - 14} 14 ${head - 38}Q-10 ${head - 13} -55 ${head - 3}Z" fill="#55504b"/>`
  return ''
}
export function characterOutfit(outfit: CharacterDetails['outfit'], head: number, accent: string): string {
  if (!outfit || outfit === 'plain') return ''
  const top = head + 57
  if (outfit === 'hoodie') return `<path d="M-22 ${top}Q-41 ${top - 24} 0 ${top - 29}Q41 ${top - 24} 22 ${top}L30 -37Q0 -30 -30 -37Z" fill="${accent}"/><path d="M-13 ${top + 2}l3 27m23 -27l-3 27M-16 -62h32l5 17h-42Z" fill="none" stroke-width="2"/>`
  if (outfit === 'dress') return `<path d="M-18 ${top}L18 ${top}L38 -25Q0 -15 -38 -25Z" fill="${accent}" fill-opacity=".3"/><path d="M-24 -65h48" fill="none"/>`
  return `<path d="M-20 ${top}L20 ${top}L27 -40L-27 -40Z" fill="${accent}" fill-opacity=".22"/><path d="M-16 ${top}L0 ${top + 20}L16 ${top}M0 ${top + 20}V-41" fill="none"/>${outfit === 'suit' || outfit === 'uniform' ? `<path d="M0 ${top + 17}l-5 9 5 25 5 -25Z" fill="${accent}"/>` : ''}${outfit === 'uniform' ? '<rect x="10" y="-83" width="9" height="7" fill="#fff" stroke-width="2"/>' : ''}`
}
export function heldProp(prop: CharacterDetails['prop'], x: number, y: number): string {
  let shape = ''
  if (prop === 'laptop') shape = '<path d="M-30 -25h60v38h-60Z M-35 14h70l-7 6h-56Z" fill="#b6c7d5"/><path d="M-17 -14l-7 7 7 7m34 -14l7 7 -7 7" fill="none"/>'
  if (prop === 'gamepad') shape = '<path d="M-20 -12h40q18 6 15 28q-4 9 -18 -3h-34q-14 12 -18 3q-3 -22 15 -28Z" fill="#b8a5d4"/><path d="M-23 0h14m-7 -7v14"/><circle cx="20" cy="0" r="3" fill="#fff"/>'
  if (prop === 'gift') shape = '<path d="M-23 -18h46v42h-46Z" fill="#e6a2b7"/><path d="M0 -18v42m-23 -30h46M0 -18q-27 -22 -24 -7q4 11 24 7q27 -22 24 -7q-4 11 -24 7" fill="none"/>'
  if (prop === 'money') shape = '<rect x="-25" y="-14" width="50" height="29" rx="3" fill="#a5c997"/><circle cx="0" cy="0" r="8" fill="none"/>'
  if (prop === 'book') shape = '<path d="M-24 -19q12 -8 24 0q12 -8 24 0v36q-12 -8 -24 0q-12 -8 -24 0Z" fill="#9ec0d9"/><path d="M0 -19v36"/>'
  if (prop === 'phone') shape = '<rect x="-11" y="-24" width="23" height="43" rx="4" fill="#444"/><rect x="-7" y="-18" width="15" height="27" rx="2" fill="#c5e2f2" stroke="none"/>'
  if (prop === 'bag') shape = '<path d="M-12 0v-12q12 -14 24 0V0" fill="none"/><rect x="-23" y="0" width="46" height="35" rx="5" fill="#c9aa80"/>'
  if (prop === 'letter') shape = '<path d="M-25 -17h50v34h-50Z M-25 -17L0 3L25 -17" fill="#fff5d9"/>'
  if (prop === 'cup') shape = '<path d="M13 -13q22 -2 16 14q-3 8 -16 5" fill="none"/><path d="M-16 -17h33v32h-33Z" fill="#8fbdda"/>'
  if (prop === 'flowers') shape = '<path d="M0 20l-12 -45m12 45l15 -43" stroke="#83a86d"/><g fill="#e9a6af"><circle cx="-12" cy="-28" r="12"/><circle cx="15" cy="-25" r="12"/></g>'
  return shape ? `<g transform="translate(${x} ${y})" stroke-width="2.5">${shape}</g>` : ''
}
export function sceneObjects(objects: typeof OBJECTS[number][] | undefined, w: number, floor: number): string {
  return (objects ?? []).map((object, i) => {
    const x = w * (.16 + i * .22)
    const shapes = {
      table: '<path d="M-50 -65H50M-40 -65V0M40 -65V0" stroke-width="7"/>',
      chair: '<path d="M-22 0v-100h44v55h-44m44 0V0"/>',
      bed: '<path d="M-65 0v-90m0 35H65v55m-130 -40H65"/><rect x="-63" y="-76" width="127" height="32" rx="8" fill="#d8e6ed"/><rect x="-59" y="-80" width="32" height="20" rx="6" fill="#fff"/>',
      door: '<path d="M-40 0v-180h80V0"/><circle cx="25" cy="-85" r="3" fill="#222"/>',
      plant: '<path d="M-20 -35h40L13 0h-26Z" fill="#bcab91"/><path d="M0 -35v-50m0 20q-32 -25 -26 -35q28 2 26 35m0 4q30 -32 30 -14q-4 15 -30 14" fill="#9bc185"/>',
      bookshelf: '<path d="M-45 0v-155h90V0ZM-45 -100h90m-90 50h90"/><path d="M-30 -103v-35m17 35v-40m17 40l-5 -35m20 35v-35M-25 -53v-33m17 33v-35m17 35v-30" stroke="#8eacc1" stroke-width="8"/>'
    }
    return `<g transform="translate(${x} ${floor})" fill="none">${shapes[object]}</g>`
  }).join('')
}

export const OVERLAYS = ['message', 'thought', 'timer', 'money', 'hp', 'rule'] as const
export interface SceneOverlay { kind: typeof OVERLAYS[number]; label: string }
export function parseOverlay(raw: unknown): SceneOverlay | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const value = raw as Record<string, unknown>
  const kind = option(value.kind, OVERLAYS, 'overlay.kind')
  if (!kind || typeof value.label !== 'string' || !value.label.trim()) return undefined
  return { kind, label: value.label.trim().slice(0, 48) }
}
export function renderOverlay(overlay: SceneOverlay | undefined, w: number): string {
  if (!overlay) return ''
  const escaped = overlay.label.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[char]!))
  const captions = { message: 'TIN NHẮN', thought: 'SUY NGHĨ', timer: 'THỜI GIAN', money: 'SỐ DƯ', hp: 'HP', rule: 'WHAT IF' }
  return `<g transform="translate(${w / 2} 72)" font-family="sans-serif" text-anchor="middle"><rect x="-195" y="-24" width="390" height="64" rx="14" fill="#f4f7fa" stroke="#222" stroke-width="2"/><text y="-6" font-size="11" fill="#6a7787">${captions[overlay.kind]}</text><text y="22" font-size="14" fill="#222" textLength="${Math.min(355, overlay.label.length * 8)}" lengthAdjust="spacingAndGlyphs">${escaped}</text></g>`
}
