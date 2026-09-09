export const HAIR = ['none', 'short', 'long', 'bun', 'curly', 'spiky', 'ponytail', 'cap', 'beanie'] as const
export const OUTFITS = ['plain', 'hoodie', 'shirt', 'dress', 'suit', 'uniform', 'jacket', 'doctor_coat', 'apron', 'police', 'tshirt'] as const
export const AGES = ['child', 'adult', 'elder'] as const
export const EMOTIONS = ['neutral', 'happy', 'sad', 'angry', 'surprised', 'worried', 'crying', 'laughing', 'shocked', 'smug', 'in_love', 'furious'] as const
export const PROPS = ['none', 'book', 'phone', 'bag', 'letter', 'cup', 'flowers', 'laptop', 'gamepad', 'gift', 'money', 'coffee', 'briefcase', 'knife', 'umbrella', 'camera', 'key', 'microphone', 'car_wheel', 'envelope', 'shopping_bag'] as const
export const OBJECTS = ['table', 'chair', 'bed', 'door', 'plant', 'bookshelf', 'sofa', 'tv', 'window', 'lamp', 'clock', 'computer_desk', 'bench', 'car'] as const
export const CHARACTER_ROLES = ['MAIN', 'GIRLFRIEND', 'BEST_FRIEND', 'SUPPORTING'] as const
export const ROLE_COLORS = { MAIN: '#e31b23', GIRLFRIEND: '#222222', BEST_FRIEND: '#555555' } as const
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
  glasses?: boolean
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
    facing: option(actor.facing, ['left', 'right'], 'facing'),
    glasses: Boolean(actor.glasses) || actor.archetype === 'teacher' || actor.archetype === 'mentor'
  }
}
export function parseObjects(value: unknown): typeof OBJECTS[number][] | undefined {
  if (!Array.isArray(value)) return undefined
  const valid = value.map(item => option(item, OBJECTS, 'objects')).filter((x): x is typeof OBJECTS[number] => x !== undefined)
  return valid.slice(0, 6)
}

export function characterHair(hair: CharacterDetails['hair'], head: number): string {
  if (hair === 'short') return `<path d="M-55 ${head - 8}Q-48 ${head - 64} 8 ${head - 55}Q53 ${head - 51} 59 ${head - 10}L30 ${head - 31}L12 ${head - 20}L-3 ${head - 35}L-30 ${head - 18}Z" fill="#151515"/>`
  if (hair === 'long') return `<path d="M-56 ${head + 8}Q-69 ${head - 57} 0 ${head - 57}Q69 ${head - 61} 62 ${head + 48}L43 ${head + 38}Q60 ${head - 20} 15 ${head - 38}Q-5 ${head - 8} -43 ${head - 8}L-39 ${head + 47}L-62 ${head + 43}Z" fill="#151515"/>`
  if (hair === 'bun') return `<circle cx="43" cy="${head - 54}" r="18" fill="#151515"/><path d="M-55 ${head - 3}Q-53 ${head - 62} 8 ${head - 55}Q55 ${head - 53} 59 ${head - 4}Q26 ${head - 14} 14 ${head - 38}Q-10 ${head - 13} -55 ${head - 3}Z" fill="#151515"/>`
  if (hair === 'curly') return `<path d="M-55 ${head - 5}q12 -28 28 -14q15 -25 32 -10q20 -20 36 8q14 16 8 32" fill="#3e2723" stroke="#3e2723" stroke-width="8" stroke-linecap="round"/>`
  if (hair === 'spiky') return `<path d="M-54 ${head - 8}l12 -36l12 22l18 -42l14 24l16 -32l10 46Z" fill="#2d3748"/>`
  if (hair === 'ponytail') return `<path d="M-43 ${head - 24}Q-83 ${head - 48} -76 ${head + 8}Q-76 ${head + 25} -88 ${head + 30}Q-59 ${head + 42} -57 ${head + 3}Z" fill="#151515"/><path d="M-53 ${head - 4}Q-60 ${head - 60} 3 ${head - 56}Q56 ${head - 54} 54 ${head - 3}L39 ${head - 12}L30 ${head - 31}Q9 ${head + 4} -18 ${head - 5}L-7 ${head - 22}Q-30 ${head + 4} -53 ${head - 4}Z" fill="#151515"/>`
  if (hair === 'cap') return `<path d="M-55 ${head - 8}q22 -38 72 -24q20 6 36 16l28 6l-22 8l-22 -4Z" fill="#dc2626"/><path d="M-55 ${head - 8}q35 -30 75 -15" fill="#b91c1c"/>`
  if (hair === 'beanie') return `<path d="M-56 ${head + 2}q10 -64 56 -64q46 0 56 64Z" fill="#0284c7"/><path d="M-58 ${head + 2}h116v12h-116Z" fill="#0369a1"/><circle cx="0" cy="${head - 64}" r="8" fill="#f8fafc"/>`
  return ''
}
export function characterOutfit(outfit: CharacterDetails['outfit'], head: number, accent: string): string {
  if (!outfit || outfit === 'plain') return ''
  const top = head + 57
  if (outfit === 'suit') return `<path d="M-20 ${top}L20 ${top}L25 -30L-25 -30Z" fill="#222222"/><path d="M-10 ${top}L0 ${top + 17}L10 ${top}" fill="#fff" stroke="none"/><path d="M0 ${top + 8}l-6 7 6 8 6 -8Z M0 ${top + 23}l-7 39 7 10 7 -10Z" fill="${accent}" stroke="none"/>`
  if (outfit === 'hoodie') return `<path d="M-22 ${top}Q-41 ${top - 24} 0 ${top - 29}Q41 ${top - 24} 22 ${top}L30 -37Q0 -30 -30 -37Z" fill="${accent}"/><path d="M-13 ${top + 2}l3 27m23 -27l-3 27M-16 -62h32l5 17h-42Z" fill="none" stroke-width="2"/>`
  if (outfit === 'dress') return `<path d="M-18 ${top}L18 ${top}L38 -25Q0 -15 -38 -25Z" fill="#222222"/><path d="M-24 -65h48" fill="none"/>`
  if (outfit === 'jacket') return `<path d="M-22 ${top}L22 ${top}L32 -38L-32 -38Z" fill="#334155"/><path d="M-14 ${top}L0 ${top + 25}L14 ${top}M0 ${top + 25}V-38" fill="none" stroke="#fff" stroke-width="3"/><path d="M-22 ${top}L-8 -38m30 0L8 ${top}" stroke="#475569" stroke-width="2"/>`
  if (outfit === 'doctor_coat') return `<path d="M-24 ${top}L24 ${top}L30 -30L-30 -30Z" fill="#f8fafc" stroke="#64748b" stroke-width="2"/><path d="M-12 ${top}L0 ${top + 20}L12 ${top}M0 ${top + 20}V-30" stroke="#0284c7" stroke-width="3"/><path d="M-12 ${top + 5}q12 18 24 0" stroke="#334155" stroke-width="2" fill="none"/><circle cx="0" cy="${top + 20}" r="4" fill="#0284c7"/>`
  if (outfit === 'apron') return `<path d="M-16 ${top}L16 ${top}L24 -36L-24 -36Z" fill="${accent}" fill-opacity=".4"/><path d="M-10 ${top}L10 ${top}L14 -15L-14 -15Z" fill="${accent}"/><path d="M-8 ${top}v-12h16v12" fill="none" stroke="#222"/>`
  if (outfit === 'police') return `<path d="M-22 ${top}L22 ${top}L28 -38L-28 -38Z" fill="#1e3a8a"/><path d="M-10 -25h20" stroke="#f59e0b" stroke-width="4"/><polygon points="8,${top+10} 14,${top+16} 8,${top+22} 2,${top+16}" fill="#fbbf24"/>`
  if (outfit === 'tshirt') return `<path d="M-20 ${top}L20 ${top}L26 -38L-26 -38Z" fill="${accent}" fill-opacity=".35"/><path d="M-15 ${top}q15 10 30 0" fill="none"/>`
  return `<path d="M-20 ${top}L20 ${top}L27 -40L-27 -40Z" fill="${accent}" fill-opacity=".22"/><path d="M-16 ${top}L0 ${top + 20}L16 ${top}M0 ${top + 20}V-41" fill="none"/>${outfit === 'uniform' ? `<path d="M0 ${top + 17}l-5 9 5 25 5 -25Z" fill="${accent}"/>` : ''}${outfit === 'uniform' ? '<rect x="10" y="-83" width="9" height="7" fill="#fff" stroke-width="2"/>' : ''}`
}
export function heldProp(prop: CharacterDetails['prop'], x: number, y: number): string {
  let shape = ''
  if (prop === 'laptop') shape = '<path d="M-30 -25h60v38h-60Z M-35 14h70l-7 6h-56Z" fill="#b6c7d5"/><path d="M-17 -14l-7 7 7 7m34 -14l7 7 -7 7" fill="none"/>'
  if (prop === 'gamepad') shape = '<path d="M-20 -12h40q18 6 15 28q-4 9 -18 -3h-34q-14 12 -18 3q-3 -22 15 -28Z" fill="#b8a5d4"/><path d="M-23 0h14m-7 -7v14"/><circle cx="20" cy="0" r="3" fill="#fff"/>'
  if (prop === 'gift') shape = '<path d="M-23 -18h46v42h-46Z" fill="#e6a2b7"/><path d="M0 -18v42m-23 -30h46M0 -18q-27 -22 -24 -7q4 11 24 7q27 -22 24 -7q-4 11 -24 7" fill="none"/>'
  if (prop === 'money') shape = '<rect x="-25" y="-14" width="50" height="29" rx="3" fill="#a5c997"/><circle cx="0" cy="0" r="8" fill="none"/><path d="M-20 -9l40 18M-20 9l40 -18" stroke="#86efac" stroke-width="1.5"/>'
  if (prop === 'book') shape = '<path d="M-24 -19q12 -8 24 0q12 -8 24 0v36q-12 -8 -24 0q-12 -8 -24 0Z" fill="#9ec0d9"/><path d="M0 -19v36"/>'
  if (prop === 'phone') shape = '<rect x="-11" y="-24" width="23" height="43" rx="4" fill="#444"/><rect x="-7" y="-18" width="15" height="27" rx="2" fill="#c5e2f2" stroke="none"/><circle cx="0" cy="14" r="2" fill="#888"/>'
  if (prop === 'bag') shape = '<path d="M-12 0v-12q12 -14 24 0V0" fill="none"/><rect x="-23" y="0" width="46" height="35" rx="5" fill="#c9aa80"/>'
  if (prop === 'letter') shape = '<path d="M-25 -17h50v34h-50Z M-25 -17L0 3L25 -17" fill="#fff5d9"/>'
  if (prop === 'cup') shape = '<path d="M13 -13q22 -2 16 14q-3 8 -16 5" fill="none"/><path d="M-16 -17h33v32h-33Z" fill="#8fbdda"/>'
  if (prop === 'flowers') shape = '<path d="M0 20l-12 -45m12 45l15 -43" stroke="#83a86d"/><g fill="#e9a6af"><circle cx="-12" cy="-28" r="12"/><circle cx="15" cy="-25" r="12"/><circle cx="0" cy="-35" r="10" fill="#f43f5e"/></g>'
  if (prop === 'coffee') shape = '<path d="M-11 -16h22l-4 34h-14Z" fill="#c49a6c"/><path d="M-13 -16h26v-5h-26Z" fill="#fff"/><rect x="-12" y="-4" width="24" height="12" rx="2" fill="#78350f"/><path d="M-3 -24q4 -5 0 -9m7 9q4 -5 0 -9" stroke="#94a3b8" stroke-width="1.5" fill="none"/>'
  if (prop === 'briefcase') shape = '<rect x="-24" y="-14" width="48" height="34" rx="4" fill="#3a2f26"/><path d="M-10 -14v-8h20v8M-24 -2h48" stroke="#d5b88a"/><rect x="-5" y="-4" width="10" height="7" fill="#d5b88a"/>'
  if (prop === 'knife') shape = '<path d="M-22 6l12 -12l32 -2q-10 16 -32 16Z" fill="#e2e8f0"/><path d="M-22 6l-10 10" stroke="#713f12" stroke-width="6"/>'
  if (prop === 'umbrella') shape = '<path d="M-26 -6q26 -28 52 0Z" fill="#3b82f6"/><path d="M0 -20v38q0 8 -8 8" fill="none" stroke="#333" stroke-width="3"/>'
  if (prop === 'camera') shape = '<rect x="-20" y="-12" width="40" height="28" rx="4" fill="#333"/><circle cx="0" cy="2" r="9" fill="#64748b"/><circle cx="0" cy="2" r="5" fill="#38bdf8"/><rect x="-14" y="-17" width="10" height="5" fill="#444"/>'
  if (prop === 'key') shape = '<circle cx="-14" cy="0" r="7" fill="none" stroke="#f59e0b" stroke-width="3"/><path d="M-7 0h24m-6 0v7m-7 -7v5" stroke="#f59e0b" stroke-width="3"/>'
  if (prop === 'microphone') shape = '<rect x="-7" y="-20" width="14" height="22" rx="7" fill="#64748b"/><path d="M-11 -8q0 16 11 16t11 -16m-11 16v12m-8 0h16" fill="none" stroke="#333"/>'
  if (prop === 'car_wheel') shape = '<circle cx="0" cy="0" r="22" fill="none" stroke-width="4"/><circle cx="0" cy="0" r="7" fill="#475569"/><path d="M-22 0h15m14 0h15M0 7v15" stroke-width="4"/>'
  if (prop === 'envelope') shape = '<path d="M-22 -14h44v28h-44Z" fill="#fef08a"/><path d="M-22 -14l22 15l22 -14" fill="none" stroke="#ca8a04"/><circle cx="0" cy="2" r="4" fill="#ef4444"/>'
  if (prop === 'shopping_bag') shape = '<rect x="-18" y="-10" width="36" height="34" rx="3" fill="#f43f5e"/><path d="M-8 -10q0 -10 8 -10t8 10" fill="none" stroke="#fff" stroke-width="2.5"/><circle cx="0" cy="8" r="5" fill="#fff" fill-opacity=".5"/>'
  return shape ? `<g transform="translate(${x} ${y})" stroke-width="2.5">${shape}</g>` : ''
}
export function sceneObjects(objects: typeof OBJECTS[number][] | undefined, w: number, floor: number): string {
  return (objects ?? []).map((object, i) => {
    const x = w * (.14 + i * .18)
    const shapes: Record<typeof OBJECTS[number], string> = {
      table: '<path d="M-50 -65H50M-40 -65V0M40 -65V0" stroke-width="7"/>',
      chair: '<path d="M-22 0v-100h44v55h-44m44 0V0"/>',
      bed: '<path d="M-65 0v-90m0 35H65v55m-130 -40H65"/><rect x="-63" y="-76" width="127" height="32" rx="8" fill="#d8e6ed"/><rect x="-59" y="-80" width="32" height="20" rx="6" fill="#fff"/>',
      door: '<path d="M-40 0v-180h80V0"/><circle cx="25" cy="-85" r="3" fill="#222"/>',
      plant: '<path d="M-20 -35h40L13 0h-26Z" fill="#bcab91"/><path d="M0 -35v-50m0 20q-32 -25 -26 -35q28 2 26 35m0 4q30 -32 30 -14q-4 15 -30 14" fill="#9bc185"/>',
      bookshelf: '<path d="M-45 0v-155h90V0ZM-45 -100h90m-90 50h90"/><path d="M-30 -103v-35m17 35v-40m17 40l-5 -35m20 35v-35M-25 -53v-33m17 33v-35m17 35v-30" stroke="#8eacc1" stroke-width="8"/>',
      sofa: '<path d="M-65 -45v45h130v-45m-130 0h130M-65 -20q65 5 130 0" stroke-width="6"/><rect x="-60" y="-38" width="56" height="22" rx="4" fill="#cbd5e1" fill-opacity=".35"/><rect x="4" y="-38" width="56" height="22" rx="4" fill="#cbd5e1" fill-opacity=".35"/><path d="M-75 -35v35h15v-35Zm135 0v35h15v-35Z" fill="#94a3b8"/>',
      tv: '<rect x="-55" y="-125" width="110" height="65" rx="5" fill="#1e293b" stroke-width="3"/><rect x="-50" y="-120" width="100" height="55" rx="3" fill="#38bdf8" fill-opacity=".25"/><path d="M-15 -60l-10 60h50l-10 -60" stroke-width="3"/>',
      window: '<rect x="-42" y="-160" width="84" height="100" rx="4" fill="#e0f2fe" fill-opacity=".4" stroke-width="3"/><path d="M0 -160v100M-42 -110h84"/><path d="M-52 -165h104M-50 -165q15 40 10 95M50 -165q-15 40 -10 95" stroke-width="4" stroke="#f472b6"/>',
      lamp: '<path d="M0 0v-160m-20 0h40" stroke-width="4"/><path d="M-25 -160l8 -35h34l8 35Z" fill="#fef08a" stroke-width="3"/><circle cx="0" cy="-175" r="5" fill="#f59e0b"/>',
      clock: '<circle cx="0" cy="-195" r="22" fill="#fff" stroke-width="3"/><path d="M0 -195v-12m0 12l8 5" stroke-width="3"/><circle cx="0" cy="-195" r="2" fill="#222"/>',
      computer_desk: '<path d="M-55 -60h110M-45 -60V0M45 -60V0" stroke-width="6"/><rect x="-40" y="-105" width="45" height="32" rx="3" fill="#1e293b"/><rect x="10" y="-105" width="40" height="32" rx="3" fill="#1e293b"/><path d="M-20 -73v13M30 -73v13M-28 -60h16M22 -60h16" stroke-width="2"/>',
      bench: '<path d="M-45 0v-40h90V0M-45 -25h90M-45 -40q0 -25 90 0" stroke-width="5" stroke="#78350f"/>',
      car: '<path d="M-75 0v-30q10 -15 35 -20l25 -22h50l30 22q25 8 35 20v30Z" fill="#f1f5f9" fill-opacity=".3" stroke-width="4"/><circle cx="-40" cy="0" r="14" fill="#333"/><circle cx="65" cy="0" r="14" fill="#333"/><circle cx="-40" cy="0" r="6" fill="#fff"/><circle cx="65" cy="0" r="6" fill="#fff"/><path d="M-15 -42l18 -18h38l22 18Z" fill="#38bdf8" fill-opacity=".4"/>'
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
  const captions = { message: 'MESSAGE', thought: 'THOUGHT', timer: 'TIME', money: 'BALANCE', hp: 'HP', rule: 'WHAT IF' }
  return `<g transform="translate(${w / 2} 72)" font-family="sans-serif" text-anchor="middle"><rect x="-195" y="-24" width="390" height="64" rx="14" fill="#f4f7fa" stroke="#222" stroke-width="2"/><text y="-6" font-size="11" fill="#6a7787">${captions[overlay.kind]}</text><text y="22" font-size="14" fill="#222" textLength="${Math.min(355, overlay.label.length * 8)}" lengthAdjust="spacingAndGlyphs">${escaped}</text></g>`
}
