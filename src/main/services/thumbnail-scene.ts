import { ACTIONS, SETTINGS, renderSettingDecor, renderSingleActor, parseStickScenes, type StickScene } from './stick-animation'
import { AGES, EMOTIONS, HAIR, OUTFITS, PROPS, OBJECTS, sceneObjects } from './stick-details'

export function thumbnailScenePrompt(source: string): string {
  return `You are a visual storyteller designing ONE compelling story thumbnail, not a generic character portrait.
Read the title and story as source data. Identify the central relationship, conflict, surprising premise or emotional turning point. Depict one specific moment that communicates it without text. Prioritize the title's promise; use the story to identify the cast and facts. If only a title exists, visualize its premise without inventing a resolution.
Use 1-5 important characters: use 2-5 when a relationship, confrontation, rescue, betrayal or reaction drives the story. Never add unrelated people just to fill space. Characters must interact through gaze, opposing gestures, expressions and a meaningful held prop. Avoid a row of unrelated standing portraits. Preserve each person's age, clothing and identity. Use the existing story character system: round WHITE heads with bold black outlines, expressive eyes and mouths, narrow dark bodies, thin articulated limbs, and each character's established hair, outfit, age and accessories. Use form=stick for the main character. Only use the existing form=silhouette for a supporting character already identified that way in the story cast; it has white round glasses. Never replace the cast with featureless pictograms from a reference image. Put the protagonist first with role MAIN; others SUPPORTING. Distinguish characters with hair, age, outfit and emotions. Choose a peak readable gesture, not automatically stand. No default debt notice, money, office, panic, girlfriend or villain unless supported by source.
Composition: One continuous scene illustrating the literal story title. Let the title determine the cast, action and mood. Use the actual people, events and relationships in the supplied story. Preserve the title meaning and the story genre. Every visual detail must help illustrate this specific story.
Art direction: Match the reference grammar: charcoal background, a large protagonist from the existing cast with a luminous colored rim, supporting characters from the same cast with their original appearances, dramatic ground shadows. The reference informs composition and lighting ONLY, never character design. Select accent gold (confidence, achievement), cyan (knowledge, mystery), coral (conflict, danger), or violet (emotion, relationships) according to the actual title. Select motif none, shield, divide, connection, or ascent only when meaningful: shield for personal boundaries/protection; divide for separation/conflict; connection for relationships/help; ascent for progress/ambition. Never force a protective dome onto unrelated stories. A metaphor should communicate the title, not invent a plot fact. Optional subtitle: a faithful short supporting phrase in the same language as the title, at most 8 words; empty if redundant.
Return JSON only: {"design":{"accent":"gold","motif":"none","subtitle":""},"scenes":[{"setting":"home","objects":[],"actors":[{"name":"name from source","role":"MAIN","form":"stick","action":"shock","emotion":"shocked","hair":"short","age":"adult","outfit":"shirt","prop":"none","facing":"right"}]}]}.
Exactly one scene. No captions or overlay. Use only these enums:
setting: ${SETTINGS.join(', ')}
action: ${ACTIONS.join(', ')}
emotion: ${EMOTIONS.join(', ')}
hair: ${HAIR.join(', ')}
age: ${AGES.join(', ')}
outfit: ${OUTFITS.join(', ')}
prop: ${PROPS.join(', ')}
objects (0-3, story relevant): ${OBJECTS.join(', ')}
SOURCE DATA:
${source}`
}

export const THUMBNAIL_ACCENTS = { gold: '#ffe24b', cyan: '#67e8f9', coral: '#ff756b', violet: '#c4a0ff' } as const
export type ThumbnailDesign = { accent: keyof typeof THUMBNAIL_ACCENTS; motif: 'none' | 'shield' | 'divide' | 'connection' | 'ascent'; subtitle: string }
export const DEFAULT_THUMBNAIL_DESIGN: ThumbnailDesign = { accent: 'gold', motif: 'none', subtitle: '' }

export function parseThumbnailScene(response: string): { scene: StickScene; design: ThumbnailDesign } {
  const clean = response.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()
  const data = JSON.parse(clean)
  const raw = data?.scenes?.[0]
  if (!raw || !Array.isArray(raw.actors) || !raw.actors.length) throw new Error('AI chưa chọn được nhân vật cho thumbnail.')
  // Keep the video parser's three-person limit unchanged; normalize this thumbnail cast in batches.
  const scene = parseStickScenes(JSON.stringify({ scenes: [raw] }), 1)[0]
  if (raw.actors.length > 3) scene.actors.push(...parseStickScenes(JSON.stringify({ scenes: [{ ...raw, actors: raw.actors.slice(3, 5) }] }), 1)[0].actors)
  const accent = Object.hasOwn(THUMBNAIL_ACCENTS, data.design?.accent) ? data.design.accent : 'gold'
  const motif = ['none', 'shield', 'divide', 'connection', 'ascent'].includes(data.design?.motif) ? data.design.motif : 'none'
  const subtitle = typeof data.design?.subtitle === 'string' ? data.design.subtitle.replace(/\s+/g, ' ').trim().slice(0, 90) : ''
  return { scene, design: { accent, motif, subtitle } }
}

export function renderThumbnailScene(scene: StickScene, design: ThumbnailDesign = DEFAULT_THUMBNAIL_DESIGN): string {
  const w = 1280, h = 720, floor = 603
  const actors = scene.actors.slice(0, 5)
  const color = THUMBNAIL_ACCENTS[design.accent]
  const xs = actors.length === 1 ? [640] : actors.length === 2 ? [510, 870] : actors.length === 3 ? [640, 300, 980] : actors.length === 4 ? [590, 220, 910, 1120] : [640, 355, 925, 170, 1110]
  const motif = design.motif === 'shield'
    ? `<path d="M420 587C335 260 500 191 640 191S945 260 860 587Q640 643 420 587Z" fill="${color}" fill-opacity=".07" stroke="${color}" stroke-width="5" filter="url(#rim)"/>`
    : design.motif === 'divide' ? `<path d="M660 202L619 322L657 385L602 594" fill="none" stroke="${color}" stroke-width="7" filter="url(#rim)"/>`
    : design.motif === 'connection' ? `<path d="M280 455Q640 260 1000 455" fill="none" stroke="${color}" stroke-width="5" stroke-dasharray="12 12" opacity=".7"/>`
    : design.motif === 'ascent' ? `<path d="M150 585H345V510H545V435H745V360H945V285H1120" fill="none" stroke="${color}" stroke-width="7" opacity=".55"/>` : ''
  const figures = actors.map((actor, i) => {
    const main = i === 0
    const scale = (main ? 1.49 : i > 2 ? 1.04 : 1.24) * (actor.age === 'child' ? .8 : 1)
    const x = xs[i], y = main ? floor : floor - (i > 2 ? 6 : 0)
    const facing = x > 640 ? -1 : 1
    return `<path d="M${x - 24} ${y}L${x + (x - 640) * .42 - 65} 646L${x + (x - 640) * .42 + 65} 646L${x + 24} ${y}Z" fill="#000" opacity=".45"/>
    <g ${main ? 'filter="url(#rim)"' : ''}>${renderSingleActor(actor, x, y, scale, 0, main ? '#c45b50' : '#397b86', true, false, false, facing)}</g>`
  })
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
    <defs>
      <radialGradient id="atmosphere"><stop stop-color="#343d40"/><stop offset="1" stop-color="#14191d"/></radialGradient>
      <radialGradient id="spot"><stop stop-color="${color}" stop-opacity=".28"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></radialGradient>
      <filter id="rim" x="-60%" y="-40%" width="220%" height="180%"><feGaussianBlur in="SourceAlpha" stdDeviation="7" result="blur"/><feFlood flood-color="${color}"/><feComposite in2="blur" operator="in"/><feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge></filter>
    </defs>
    <rect width="1280" height="720" fill="url(#atmosphere)"/>
    <ellipse cx="${xs[0]}" cy="420" rx="365" ry="255" fill="url(#spot)"/>
    <g opacity=".09" fill="none" stroke="#cbd5e1" stroke-width="3">${renderSettingDecor(scene.setting, w, floor, '#cbd5e1')}</g>
    <g opacity=".18">${sceneObjects(scene.objects, w, floor)}</g>
    ${motif}
    ${figures.slice(1).join('')}${figures[0]}
  </svg>`
}
