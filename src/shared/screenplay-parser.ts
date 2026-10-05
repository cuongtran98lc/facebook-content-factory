import type { EngineScene, ScriptBeat, StickmanContentPackage, StickmanIdea } from './stickman-engine';

export interface ParsedScreenplayActor {
  name: string;
  role: 'MAIN' | 'GIRLFRIEND' | 'BEST_FRIEND' | 'SUPPORTING';
  action: string;
  emotion: string;
  outfit?: string;
  prop?: string;
  glasses?: boolean;
  facing?: 'left' | 'right';
  position?: 'left' | 'center' | 'right';
}

export interface ParsedScreenplayScene {
  index: number;
  partTitle?: string;
  timeRange: string;
  label: string;
  visualCues: string[];
  visualDescription: string;
  soundEffects: string[];
  overlayText?: string;
  actors: ParsedScreenplayActor[];
  dialogues: Array<{ speaker: string; text: string }>;
  narration: string;
  rawText: string;
  setting: string;
  action: string;
  emotion: string;
  camera: 'close-up' | 'medium' | 'wide';
  imagePrompt: string;
  animationPrompt: string;
}

export interface ParsedScreenplay {
  title: string;
  premise: string;
  parts: Array<{ title: string; timeRange?: string }>;
  characters: string[];
  scenes: ParsedScreenplayScene[];
}

/**
 * Check if the text matches a structured screenplay / cued script format
 */
export function isScreenplayScript(text: string): boolean {
  if (!text || typeof text !== 'string') return false;
  const hasTimeHooks = /\[\s*\d{1,2}:\d{2}[^\]]*\]/i.test(text);
  const hasNamedHooks = /\[\s*(Hook|Đồng cảm|Kể chuyện|Bí mật|Mẹo|Kết|Intro|Outro|Scene|Cảnh)[^\]]*\]/i.test(text);
  const hasParts = /Phần\s+\d+\s*:/i.test(text);
  const hasVisualCues = /\((?:Cảnh|Bật đèn|Đóng tủ|Cắt sang|Chèn|Nhạc|Hiệu ứng|nhìn camera|vỗ tay|mắt rưng rưng|Quay đi|Một… hai|Ba việc)[^\)]*\)/i.test(text);
  const hasCharacterDialogues = /(?:^|\n)\s*(Tôi|Não|Alex|Emma|Sếp|Mẹ|Bạn|[A-ZÀ-Ỹa-zà-ỹ0-9_]{1,15})\s*:\s+/i.test(text);

  let score = 0;
  if (hasTimeHooks) score += 3;
  if (hasNamedHooks) score += 2;
  if (hasParts) score += 2;
  if (hasVisualCues) score += 2;
  if (hasCharacterDialogues) score += 2;

  return score >= 3;
}

/**
 * Clean narration text for TTS voiceover. Strips out stage directions (...),
 * timestamp markers [...], part headers, and sound effect annotations.
 */
export function cleanNarrationForTTS(text: string): string {
  if (!text) return '';
  return text
    // Remove part headers like "Phần 1: Tối thứ Sáu và cái tủ lạnh (0:00–2:30)"
    .replace(/^Phần\s+\d+:[^\n]*\n?/gmi, '')
    // Remove bracketed scene headers like "[0:00 – Hook]" or "[Hook]"
    .replace(/\[[^\]]+\]/g, '')
    // Remove parenthetical stage cues like "(Cảnh tối, chỉ có ánh đèn...)" or "("LẦN 1 – 9:03")"
    .replace(/\([^\)]*\)/g, '')
    // Remove standalone quote labels like "LẦN 1 – 9:03"
    .replace(/"LẦN\s+\d+[^"]*"/gi, '')
    // Clean redundant whitespace and empty lines
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .join(' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/**
 * Extract visual cues, stage directions, sound effects, and clean dialogue
 */
export function extractVisualCues(text: string): {
  cues: string[];
  cleanText: string;
  soundEffects: string[];
  overlayText?: string;
} {
  const cues: string[] = [];
  const soundEffects: string[] = [];
  let overlayText: string | undefined;

  // Extract all content in parentheses
  const parenRegex = /\(([^)]+)\)/g;
  let pMatch: RegExpExecArray | null;
  while ((pMatch = parenRegex.exec(text)) !== null) {
    const raw = pMatch[1].trim();
    if (!raw) continue;
    // Check if sound effect or music
    if (/nhạc|âm thanh|ting|tiếng|vỗ tay|hiệu ứng/i.test(raw)) {
      soundEffects.push(raw);
    }
    // Check if on-screen text / overlay
    const overlayMatch = raw.match(/chèn chữ[^:]*:\s*([^)]+)/i) || raw.match(/hiện chữ[^:]*:\s*([^)]+)/i);
    if (overlayMatch) {
      overlayText = overlayMatch[1].replace(/["']/g, '').trim();
    }
    cues.push(raw);
  }

  // Also check quotes for overlays like "LẦN 1 – 9:03"
  const quoteRegex = /"([^"]{3,40})"/g;
  let qMatch: RegExpExecArray | null;
  while ((qMatch = quoteRegex.exec(text)) !== null) {
    if (/LẦN\s+\d+/i.test(qMatch[1])) {
      cues.push(`Chèn chữ: ${qMatch[1]}`);
      if (!overlayText) overlayText = qMatch[1];
    }
  }

  const cleanText = cleanNarrationForTTS(text);
  return { cues, cleanText, soundEffects, overlayText };
}

/**
 * Infer setting, action, emotion, camera from text & visual cues
 */
function inferSceneAttributes(text: string, cues: string[]): {
  setting: string;
  action: string;
  emotion: string;
  camera: 'close-up' | 'medium' | 'wide';
  prop?: string;
  actors: ParsedScreenplayActor[];
} {
  const combined = `${text} ${cues.join(' ')}`.toLowerCase();

  // Setting
  let setting = 'home';
  if (/tủ lạnh|bếp|cánh cửa này|chai tương ớt|hộp cơm|ngăn đá|bánh flan|rót cốc nước/.test(combined)) {
    setting = 'home';
  } else if (/báo cáo|email sếp|sếp|laptop|máy tính|deadline|công ty|văn phòng/.test(combined)) {
    setting = 'office';
  } else if (/đà lạt|công viên|ngoài trời|du lịch/.test(combined)) {
    setting = 'park';
  } else if (/trường|lớp|học/.test(combined)) {
    setting = 'school';
  } else if (/quán cà phê|cafe|coffee/.test(combined)) {
    setting = 'cafe';
  }

  // Action
  let action = 'stand';
  if (/gõ|mở laptop|làm nốt báo cáo|viết tiếp báo cáo/.test(combined)) {
    action = 'type';
  } else if (/chỉ vào đầu|chỉ vào|nhìn thẳng camera|bật đèn/.test(combined)) {
    action = 'point';
  } else if (/rót cốc nước|uống|cốc nước/.test(combined)) {
    action = 'drink';
  } else if (/lướt điện thoại|cầm điện thoại|điện thoại/.test(combined)) {
    action = 'phone';
  } else if (/vỗ tay|ăn mừng|giỏi/.test(combined)) {
    action = 'cheer';
  } else if (/khoanh tay|đứng dậy|mở cánh cửa|mở tủ/.test(combined)) {
    action = 'stand';
  } else if (/ngồi|bàn làm việc/.test(combined)) {
    action = 'sit';
  } else if (/bước đi|chân tự đi|đi về phía/.test(combined)) {
    action = 'walk';
  } else if (/nói|lên tiếng|giọng nói/.test(combined)) {
    action = 'talk';
  }

  // Emotion
  let emotion = 'neutral';
  if (/hồi hộp|trinh thám|căng thẳng|lo lắng|khó chịu|tủi/.test(combined)) {
    emotion = 'worried';
  } else if (/mắt rưng rưng|buồn|buồn bã/.test(combined)) {
    emotion = 'crying';
  } else if (/tự hào|giỏi|vui|ngày đẹp nhất/.test(combined)) {
    emotion = 'happy';
  } else if (/lại là cậu à|đeo kính|khoanh tay|tôi nói từ lần một/.test(combined)) {
    emotion = 'smug';
  } else if (/ting|giọng nói|sốc|kinh ngạc|không tin/.test(combined)) {
    emotion = 'shocked';
  }

  // Camera
  let camera: 'close-up' | 'medium' | 'wide' = 'medium';
  if (/chiếu lên mặt|chỉ vào đầu|mắt rưng rưng|cận cảnh|nhìn camera đầy tự hào/.test(combined)) {
    camera = 'close-up';
  } else if (/cả hai|toàn cảnh|quay sang nhìn|chèn lại nhanh 3 cảnh/.test(combined)) {
    camera = 'wide';
  }

  // Props
  let prop: string | undefined;
  if (/laptop|máy tính/.test(combined)) prop = 'laptop';
  else if (/điện thoại/.test(combined)) prop = 'phone';
  else if (/cốc nước|nước/.test(combined)) prop = 'coffee';
  else if (/báo cáo|email/.test(combined)) prop = 'contract';

  // Actors
  const actors: ParsedScreenplayActor[] = [];
  const hasBrainCharacter = /não\s*:|nhân vật não|khoanh tay|đeo kính/.test(combined);
  const hasMainCharacter = /tôi\s*:|mình|chân tự đi|tay chạm vào/.test(combined) || !hasBrainCharacter;

  if (hasMainCharacter) {
    actors.push({
      name: 'Tôi',
      role: 'MAIN',
      action: hasBrainCharacter && /não\s*:/.test(combined) ? 'talk' : action,
      emotion: emotion === 'smug' ? 'shocked' : emotion,
      outfit: 'suit',
      prop,
      position: hasBrainCharacter ? 'left' : 'center',
      facing: hasBrainCharacter ? 'right' : 'right'
    });
  }

  if (hasBrainCharacter) {
    actors.push({
      name: 'Não',
      role: 'SUPPORTING',
      action: /vỗ tay/.test(combined) ? 'cheer' : 'stand',
      emotion: 'smug',
      glasses: true,
      outfit: 'uniform',
      position: 'right',
      facing: 'left'
    });
  }

  return { setting, action, emotion, camera, prop, actors };
}

/**
 * Generate rich image generation prompts based on parsed visual cues
 */
function buildSceneImagePrompt(
  label: string,
  visualCues: string[],
  cleanNarration: string,
  attrs: ReturnType<typeof inferSceneAttributes>
): string {
  const promptParts: string[] = [];

  // 1. Direct cues from user script
  const cueCombined = visualCues.join('. ');
  if (cueCombined.length > 0) {
    promptParts.push(`Detailed scene composition: ${cueCombined}.`);
  }

  // 2. Specific scenario enrichment
  const lower = `${cueCombined} ${cleanNarration}`.toLowerCase();
  if (lower.includes('tủ lạnh') || lower.includes('đèn tủ lạnh')) {
    promptParts.push('Dark kitchen at night, face illuminated by cold blue-white light radiating from inside an open refrigerator, shelves visible with lemon, sauce bottle and food containers.');
  }
  if (lower.includes('nhìn thẳng camera') || lower.includes('bật đèn')) {
    promptParts.push('Bright room lights turned on, character looking directly into the camera breaking the fourth wall, pointing finger to head with insightful expression.');
  }
  if (lower.includes('não') || lower.includes('đeo kính') || attrs.actors.some(a => a.name === 'Não')) {
    promptParts.push('Two characters in scene: protagonist Sticky Man alongside character Brain (stylized persona with round eyeglasses and smug arms-crossed posture).');
  }
  if (lower.includes('tín hiệu') || lower.includes('phần thưởng') || lower.includes('vòng lặp')) {
    promptParts.push('Infographic habit loop flowchart diagram on screen showing SIGNAL -> ACTION -> REWARD with a cute sad doodle lemon.');
  }
  if (lower.includes('rót cốc nước') || lower.includes('cốc nước')) {
    promptParts.push('Character turning away from refrigerator with pride, pouring a clean cup of water.');
  }

  // 3. Stickman aesthetic foundation
  promptParts.push(
    `Expression: ${attrs.emotion}. Action: ${attrs.action}. Location: ${attrs.setting}.`,
    'Sticky Man 2D vector comic illustration, round smooth white head, crisp bold black outlines, sharp black tailored business suit with red necktie.',
    'Cel-shaded graphic novel art, framed composition with margins, high contrast, clean vector lines, no realistic human, no 3D CGI.'
  );

  return promptParts.join(' ');
}

/**
 * Parse an entire script with scenes, parts, cues, and dialogues into structured objects
 */
export function parseScreenplay(rawText: string, defaultTitle?: string): ParsedScreenplay {
  const text = rawText.replace(/\r\n/g, '\n').trim();

  // Extract title
  let title = defaultTitle || '';
  const titlePartMatch = text.match(/Phần\s+1\s*:\s*([^(\n]+)/i);
  if (titlePartMatch) {
    title = titlePartMatch[1].trim();
  } else if (!title) {
    const firstLine = text.split('\n')[0].replace(/^#+\s*/, '').trim();
    if (firstLine.length < 80) title = firstLine;
    else title = 'Kịch Bản Hoạt Hình Phân Cảnh';
  }

  // Extract Parts
  const parts: Array<{ title: string; timeRange?: string }> = [];
  const partRegex = /Phần\s+(\d+)\s*:\s*([^\n]+)/gi;
  let partMatch: RegExpExecArray | null;
  while ((partMatch = partRegex.exec(text)) !== null) {
    const full = partMatch[2].trim();
    const timeM = full.match(/\(([^)]+)\)/);
    parts.push({
      title: full.replace(/\([^)]+\)/, '').trim(),
      timeRange: timeM ? timeM[1].trim() : undefined
    });
  }

  // Split text into scene blocks
  // Delimiters: [time – label] or [label] or Phần X:
  const lines = text.split('\n');
  const sceneBlocks: Array<{
    partTitle?: string;
    header: string;
    lines: string[];
  }> = [];

  let currentPart: string | undefined;
  let currentHeader = 'Mở đầu (Hook)';
  let currentLines: string[] = [];

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    // Check Part header
    const pMatch = line.match(/^Phần\s+\d+\s*:\s*([^\n]+)/i);
    if (pMatch) {
      currentPart = line;
      continue;
    }

    // Check Scene marker [time - label] or [label]
    const sceneMarkerMatch = line.match(/^\[\s*(\d{1,2}:\d{2}(?:[–-]\d{1,2}:\d{2})?)?\s*(?:[–-]\s*)?([^\]]+)\]/i);
    if (sceneMarkerMatch) {
      if (currentLines.length > 0) {
        sceneBlocks.push({
          partTitle: currentPart,
          header: currentHeader,
          lines: [...currentLines]
        });
        currentLines = [];
      }
      currentHeader = line;
      continue;
    }

    currentLines.push(line);
  }

  if (currentLines.length > 0) {
    sceneBlocks.push({
      partTitle: currentPart,
      header: currentHeader,
      lines: [...currentLines]
    });
  }

  // If no [marker] was found, try splitting by paragraphs or character cues
  if (sceneBlocks.length <= 1 && text.length > 200) {
    const paragraphs = text.split(/\n{2,}/).map(p => p.trim()).filter(Boolean);
    if (paragraphs.length > 1) {
      sceneBlocks.length = 0;
      paragraphs.forEach((p, idx) => {
        sceneBlocks.push({
          partTitle: currentPart,
          header: `Phân đoạn #${idx + 1}`,
          lines: [p]
        });
      });
    }
  }

  // Build ParsedScreenplayScene objects
  const characterSet = new Set<string>();
  const scenes: ParsedScreenplayScene[] = sceneBlocks.map((block, idx) => {
    const rawSceneText = block.lines.join('\n');
    const { cues, cleanText, soundEffects, overlayText } = extractVisualCues(rawSceneText);

    // Parse header for time range and label
    const headerMatch = block.header.match(/^\[\s*(\d{1,2}:\d{2}(?:[–-]\d{1,2}:\d{2})?)?\s*(?:[–-]\s*)?([^\]]+)\]/i);
    const timeRange = headerMatch?.[1] || `${Math.floor(idx * 20 / 60)}:${String((idx * 20) % 60).padStart(2, '0')}`;
    const label = headerMatch?.[2]?.trim() || block.header.replace(/^\[|\]$/g, '').trim() || `Phân đoạn ${idx + 1}`;

    // Extract dialogues
    const dialogues: Array<{ speaker: string; text: string }> = [];
    const dialogueRegex = /(?:^|\n)\s*([A-ZÀ-Ỹa-zà-ỹ0-9_ ]{1,15})\s*:\s*([^\n]+)/g;
    let dMatch: RegExpExecArray | null;
    while ((dMatch = dialogueRegex.exec(rawSceneText)) !== null) {
      const spk = dMatch[1].trim();
      const speech = cleanNarrationForTTS(dMatch[2].trim());
      if (spk && speech) {
        dialogues.push({ speaker: spk, text: speech });
        characterSet.add(spk);
      }
    }

    const attrs = inferSceneAttributes(rawSceneText, cues);
    attrs.actors.forEach(a => characterSet.add(a.name));

    const imagePrompt = buildSceneImagePrompt(label, cues, cleanText, attrs);
    const animationPrompt = `2D cel-shaded vector animation of character Sticky Man actively speaking with dynamic mouth movement and lip-sync in sync with narration, natural blinking eyes, expressive gestures in ${attrs.setting}. Smooth fluid motion, static camera ${attrs.camera} shot, clean outlines, no morphing.`;

    const visualDescription = cues.length > 0 ? cues.join('. ') : `${attrs.action} in ${attrs.setting}`;

    return {
      index: idx + 1,
      partTitle: block.partTitle,
      timeRange,
      label,
      visualCues: cues,
      visualDescription,
      soundEffects,
      overlayText,
      actors: attrs.actors,
      dialogues,
      narration: cleanText || rawSceneText,
      rawText: rawSceneText,
      setting: attrs.setting,
      action: attrs.action,
      emotion: attrs.emotion,
      camera: attrs.camera,
      imagePrompt,
      animationPrompt
    };
  });

  return {
    title,
    premise: scenes[0]?.narration?.slice(0, 150) || title,
    parts,
    characters: Array.from(characterSet),
    scenes
  };
}

/**
 * Convert parsed screenplay into StickmanEngine ScriptBeat[]
 */
export function screenplayToScriptBeats(screenplay: ParsedScreenplay): ScriptBeat[] {
  return screenplay.scenes.map((scene, idx) => ({
    id: `beat_${idx + 1}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    timeRange: scene.timeRange || `0:${String(idx * 15).padStart(2, '0')}`,
    label: scene.label,
    narration: scene.narration,
    dialogue: scene.dialogues.length > 0 ? scene.dialogues.map(d => `${d.speaker}: ${d.text}`).join('\n') : undefined,
    action: scene.action,
    emotion: scene.emotion,
    camera: scene.camera,
    soundEffect: scene.soundEffects[0]
  }));
}

/**
 * Convert parsed screenplay into StickmanEngine EngineScene[]
 */
export function screenplayToEngineScenes(screenplay: ParsedScreenplay): EngineScene[] {
  return screenplay.scenes.map((scene, idx) => ({
    sceneNumber: idx + 1,
    duration: 5,
    location: scene.setting,
    characters: scene.actors.map(a => ({
      name: a.name,
      action: a.action,
      emotion: a.emotion,
      outfit: a.outfit,
      prop: a.prop
    })),
    narration: scene.narration,
    dialogue: scene.dialogues.length > 0 ? scene.dialogues.map(d => `${d.speaker}: ${d.text}`).join('\n') : undefined,
    action: scene.action,
    emotion: scene.emotion,
    camera: scene.camera,
    visualDescription: scene.visualDescription,
    imagePrompt: scene.imagePrompt,
    animationPrompt: scene.animationPrompt,
    soundEffect: scene.soundEffects[0]
  }));
}

/**
 * Convert parsed screenplay into a full StickmanIdea object
 */
export function screenplayToStickmanIdea(screenplay: ParsedScreenplay, format: 'SHORT' | 'LONG' = 'SHORT'): StickmanIdea {
  const main = screenplay.characters.find(c => /tôi|alex|nam|nữ/i.test(c)) || screenplay.characters[0] || 'Tôi';
  const supporting = screenplay.characters.filter(c => c !== main);

  return {
    id: `idea_custom_${Date.now()}`,
    workingTitle: screenplay.title,
    premise: screenplay.scenes.slice(0, 2).map(s => s.narration).join(' ').slice(0, 300) || screenplay.title,
    pillarId: 'mindset',
    targetMarket: 'Vietnam / Global',
    targetAudience: 'Người trẻ, nhân viên văn phòng, người hay trì hoãn',
    recommendedFormat: format,
    mainCharacter: main,
    supportingCharacters: supporting.length > 0 ? supporting : ['Não'],
    relationship: 'Nội tâm vs Hành động thực tế',
    setting: screenplay.scenes[0]?.setting || 'Nhà riêng / Bếp',
    conflict: 'Thói quen mở tủ lạnh khi chán và cuộc đối thoại với Não',
    emotionalTrigger: 'Đồng cảm, hài hước, thức tỉnh thói quen',
    twist: 'Tủ lạnh chính là một mạng xã hội thu nhỏ - chỉ là lạnh hơn',
    ending: 'Thỏa thuận với Não: 3 giây dừng lại trước khi mở tủ',
    hook: screenplay.scenes[0]?.narration?.slice(0, 120) || screenplay.title,
    whyItMayWork: 'Đánh trúng tâm lý phổ biến của mọi người khi làm việc ban đêm, kết hợp nhân cách hóa nhân vật Não tạo tính hài hước và giáo dục.',
    originalityAngle: 'Nhân cách hóa bộ não thành nhân vật đối thoại trực tiếp trong căn bếp đêm.',
    estimatedComplexity: 'MEDIUM',
    score: {
      overall: 95,
      hookStrength: 98,
      curiosity: 95,
      emotionalIntensity: 90,
      relatability: 99,
      twistPotential: 92,
      visualPotential: 96,
      seriesPotential: 94
    }
  };
}

/**
 * Convert screenplay text into section strings for storySections()
 * Preserves the scene structure, headers, and cues so downstream consumers receive
 * exact per-scene chunks!
 */
export function screenplayToSections(text: string): string[] {
  const screenplay = parseScreenplay(text);
  if (!screenplay.scenes.length) return [text];
  return screenplay.scenes.map(s => s.rawText || s.narration);
}

export const SAMPLE_REFRIGERATOR_SCRIPT = `Phần 1: Tối thứ Sáu và cái tủ lạnh (0:00–2:30)
[0:00 – Hook]
(Cảnh tối, chỉ có ánh đèn tủ lạnh chiếu lên mặt. Nhạc hồi hộp kiểu phim trinh thám.)
Tôi: 10 giờ tối. Lần thứ năm trong một tiếng, mình mở cánh cửa này. Bên trong vẫn là nửa quả chanh, chai tương ớt, và một hộp cơm nguội từ thứ Ba. Mình biết. Mình biết hết. Nhưng mình vẫn mở.
(Đóng tủ. Ba giây sau, mở lại.)
Tôi: …Lỡ đâu.
[0:15 – Đồng cảm và hứa hẹn]
(Bật đèn, nhìn thẳng camera.)
Tôi: Nếu bạn cũng từng đứng trước tủ lạnh như đang chờ nó tự nấu cho mình một bữa, thì chúc mừng, bạn là con người. Hôm nay mình sẽ cho bạn gặp thủ phạm thật sự. Không phải cái bụng. Là cái này. (chỉ vào đầu)
[0:45 – Kể chuyện]
Tôi: Chuyện bắt đầu lúc 9 giờ tối. Mình mở laptop, định làm nốt báo cáo. Viết được đúng một dòng: "Báo cáo tháng 9". Rồi mình đứng dậy. Đi thẳng tới tủ lạnh. Không ai bảo cả. Chân tự đi.
(Cảnh tua nhanh, chèn chữ trên màn hình: "LẦN 1 – 9:03")
Tôi: Lần 1: mở ra, nhìn, đóng lại. Không đói lắm.
("LẦN 2 – 9:15") Lần 2: sau khi đọc email sếp. Mở ra, nhìn hộp sữa chua đã hết hạn. Đóng lại.
("LẦN 3 – 9:31") Lần 3: lướt điện thoại thấy bạn cũ đi Đà Lạt. Mở tủ lạnh. Lần này mình mở thêm cả ngăn đá. Như thể kem sẽ tự mọc ra.
("LẦN 4 – 9:48") Lần 4: không có lý do gì cả. Đơn giản là… đến giờ mở tủ lạnh.
("LẦN 5 – 10:00") Lần 5: mình mở ra, và nghe thấy một giọng nói.
(Hiệu ứng âm thanh "ting". Cắt sang nhân vật Não, đeo kính, khoanh tay.)
Não: Lại là cậu à.
Phần 2: Não lên tiếng (2:30–5:00)
[2:30 – Bí mật thứ nhất: không phải đói, mà là chán]
Tôi: Ủa, sao giờ mới nói? Năm lần rồi đó!
Não: Tôi nói từ lần một mà. Cậu có nghe đâu. Nhìn lại xem, mỗi lần cậu mở tủ là ngay sau chuyện gì?
(Chèn lại nhanh 3 cảnh: báo cáo viết một dòng, email sếp, ảnh bạn cũ đi Đà Lạt.)
Tôi: …Báo cáo. Sếp. Đà Lạt.
Não: Chính xác. Chán, căng thẳng, hơi tủi. Mỗi lần thấy khó chịu, tôi đi tìm một thứ gì đó dễ chịu hơn một chút. Mà trong cái nhà này, thứ gần nhất phát sáng và có khả năng chứa đồ ngon là…
(Cả hai cùng quay sang nhìn tủ lạnh. Nhạc thánh ca.)
[3:15 – Bí mật thứ hai: vòng lặp thói quen]
Não: Các nhà nghiên cứu gọi đây là vòng lặp thói quen. Có ba bước. Một: tín hiệu, tức là cảm giác chán. Hai: hành động, tức là mở tủ. Ba: phần thưởng.
Tôi: Nhưng có phần thưởng gì đâu! Toàn nửa quả chanh!
Não: Phần thưởng là được đứng dậy, được thoát khỏi cái báo cáo trong 30 giây, và được hy vọng. Thế là đủ với tôi rồi. Lặp lại vài lần, chân cậu tự biết đường.
(Chèn chữ trên màn hình: TÍN HIỆU → HÀNH ĐỘNG → PHẦN THƯỞNG, kèm hình chanh buồn bã.)
[4:00 – Bí mật thứ ba: "lỡ đâu"]
Tôi: Nhưng sao mình biết là trống rồi mà vẫn mở lại?
Não: Vì đôi khi nó KHÔNG trống. Có lần mẹ cậu ghé qua, nhét vào một hộp bánh flan. Cậu nhớ không?
Tôi: (mắt rưng rưng) Ngày đẹp nhất tháng Tư.
Não: Đấy. Khi phần thưởng lúc có lúc không, tôi lại càng muốn kiểm tra. Giống như cậu lướt điện thoại mãi vì biết đâu video tiếp theo sẽ hay. Tủ lạnh chính là một cái mạng xã hội. Chỉ là lạnh hơn.
Tôi: Vậy là mình… đang lướt tủ lạnh?
Não: Cậu đang lướt tủ lạnh.
Phần 3: Thỏa thuận với Não (5:00–7:00)
[5:00 – Mẹo áp dụng]
Tôi: Được rồi, vậy giờ mình phải làm sao? Khóa tủ lạnh à?
Não: Không cần căng vậy. Ba việc thôi.
(Chữ hiện lên màn hình theo từng mẹo.)
Não: Một: tay chạm vào cửa tủ thì dừng ba giây, tự hỏi "mình đói, hay mình chán?". Chỉ cần gọi đúng tên là tôi bớt đẩy cậu đi rồi.
Tôi: Ba giây. Được.
Não: Hai: nếu là chán, cho tôi một phần thưởng khác. Đứng dậy vươn vai, rót cốc nước, nhắn cho bạn một câu. Tôi cần được giải lao, không nhất thiết là cần ăn.
Tôi: Còn nếu đói thật?
Não: Thì ăn đàng hoàng. Đói thì ăn, có gì đâu mà phải xấu hổ. Ba: nếu cậu hay muốn nghỉ giữa giờ làm, đặt sẵn khoảng nghỉ. Làm 25 phút, nghỉ 5 phút. Tôi biết sắp được nghỉ thì tôi ngoan hơn.
[6:30 – Câu chốt và dẫn sang video khác]
(Tôi quay lại bàn, viết tiếp báo cáo. Vài giây sau, đứng dậy. Đi về phía tủ lạnh. Dừng lại trước cửa tủ. Đếm.)
Tôi: Một… hai… ba… Mình chán.
(Quay đi, rót cốc nước. Nhìn camera đầy tự hào.)
Não: (vỗ tay chậm) Giỏi. Giờ đi viết báo cáo.
Tôi: (cầm điện thoại lên) Ừ, mình xem một video thôi rồi viết.
Não: …
Tôi: (nhìn camera) Mà nói đến chuyện "xem một video thôi", tại sao bạn lướt điện thoại ba tiếng mà vẫn thấy chán? Câu trả lời còn khó đỡ hơn cái tủ lạnh. Video đó ở ngay đây.
(Màn hình kết thúc: video "Tại sao bạn lướt điện thoại 3 tiếng mà vẫn thấy chán?" + nút đăng ký.)`;
