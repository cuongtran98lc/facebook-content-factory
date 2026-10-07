import { stickFrame, renderSingleActor, type StickScene } from '../src/main/services/stick-animation';
import sharp from 'sharp';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

async function main() {
  const outputDir = join(process.cwd(), 'output', 'test_scenes');
  const artifactDir = '/Users/mac/.gemini/antigravity-ide/brain/e46ca310-b026-4a75-9a7f-a1870b993383';
  await mkdir(outputDir, { recursive: true });
  await mkdir(artifactDir, { recursive: true });

  const colors = new Map<string, string>();
  colors.set('Alex', '#e31b23');
  colors.set('Sếp', '#111111');
  colors.set('Emma', '#222222');

  // Test 1: Office Explainer Scene (Exact match to reference image)
  // Left: Alex (Stickman Presenter, white head, black necktie, pointing gesture)
  // Right: Clerk/Boss (Solid black silhouette, round white glasses, writing at desk with paper & book stacks)
  // Background: Warm cream paper office setting
  const sceneOffice: StickScene = {
    setting: 'office',
    objects: ['paper_stacks'],
    actors: [
      {
        name: 'Alex',
        role: 'MAIN',
        form: 'stick',
        action: 'point',
        emotion: 'happy',
        outfit: 'suit',
        hair: 'none',
        age: 'adult',
        position: 'left',
        facing: 'right'
      },
      {
        name: 'Đồng nghiệp',
        role: 'SUPPORTING',
        form: 'silhouette',
        action: 'write',
        emotion: 'neutral',
        outfit: 'suit',
        hair: 'none',
        age: 'adult',
        glasses: true,
        position: 'right',
        facing: 'left'
      }
    ]
  };

  // Test 2: Cafe Scene (Flexible background: warm latte tones, character holding coffee)
  const sceneCafe: StickScene = {
    setting: 'cafe',
    objects: ['table'],
    actors: [
      {
        name: 'Alex',
        role: 'MAIN',
        form: 'stick',
        action: 'drink',
        prop: 'coffee',
        emotion: 'happy',
        outfit: 'suit',
        hair: 'none',
        age: 'adult',
        position: 'center',
        facing: 'right'
      }
    ]
  };

  // Test 3: Street Scene (Flexible background: daylight street pavement & city skyline)
  const sceneStreet: StickScene = {
    setting: 'street',
    actors: [
      {
        name: 'Alex',
        role: 'MAIN',
        form: 'stick',
        action: 'walk',
        prop: 'phone',
        emotion: 'worried',
        outfit: 'suit',
        hair: 'none',
        age: 'adult',
        position: 'center',
        facing: 'right'
      }
    ]
  };

  // Test 4: Bedroom Scene (Flexible background: cozy twilight lavender evening)
  const sceneBedroom: StickScene = {
    setting: 'bedroom',
    objects: ['bed', 'lamp'],
    actors: [
      {
        name: 'Alex',
        role: 'MAIN',
        form: 'stick',
        action: 'think',
        emotion: 'worried',
        outfit: 'suit',
        hair: 'none',
        age: 'adult',
        position: 'left',
        facing: 'right'
      }
    ]
  };

  const tests = [
    { name: 'test_scene_01_office_cream.png', scene: sceneOffice },
    { name: 'test_scene_02_cafe_warm.png', scene: sceneCafe },
    { name: 'test_scene_03_street_city.png', scene: sceneStreet },
    { name: 'test_scene_04_bedroom_night.png', scene: sceneBedroom },
  ];

  for (const t of tests) {
    const svg = stickFrame(t.scene, 0, 'LANDSCAPE', colors, true, 'DOODLE_2D');
    const pngBuffer = await sharp(Buffer.from(svg)).resize(1280, 720).png().toBuffer();
    
    const outPath = join(outputDir, t.name);
    const artPath = join(artifactDir, t.name);
    await writeFile(outPath, pngBuffer);
    await writeFile(artPath, pngBuffer);
    console.log(`Rendered: ${t.name} -> ${outPath}`);
  }

  // Test 5: Full 8-pose Bean Stickman Character Sheet (Directly matching the user's reference image)
  const sheetPoses = [
    // Top Row: Wave, Walk, Point, Dance
    { action: 'wave' as const, emotion: 'happy' as const, x: 180, y: 310, name: 'Wave' },
    { action: 'walk' as const, emotion: 'neutral' as const, x: 470, y: 310, name: 'Walk' },
    { action: 'point' as const, emotion: 'neutral' as const, x: 760, y: 310, name: 'Point' },
    { action: 'dance' as const, emotion: 'happy' as const, x: 1050, y: 310, name: 'Dance' },
    // Bottom Row: Stand (Idle), Shy (Hands on belly), Cheer (Hooray), Talk / Sing (Microphone)
    { action: 'stand' as const, emotion: 'happy' as const, x: 180, y: 640, name: 'Stand' },
    { action: 'beg' as const, trait: 'shy' as const, emotion: 'neutral' as const, x: 470, y: 640, name: 'Shy' },
    { action: 'cheer' as const, emotion: 'happy' as const, x: 760, y: 640, name: 'Cheer' },
    { action: 'talk' as const, prop: 'microphone' as const, emotion: 'happy' as const, x: 1050, y: 640, name: 'Sing' },
  ];

  const actorsSvg = sheetPoses.map(p => {
    return renderSingleActor(
      {
        name: p.name,
        role: 'SUPPORTING',
        form: 'stick',
        action: p.action,
        trait: (p as any).trait,
        emotion: p.emotion,
        prop: (p as any).prop,
        outfit: 'plain',
        hair: 'none',
        age: 'adult',
        position: 'center',
        facing: 'right'
      },
      p.x,
      p.y,
      0.95,
      0,
      '#e31b23',
      true,
      false
    );
  }).join('\n');

  const sheetSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1280 720" width="1280" height="720">
    <rect width="1280" height="720" fill="#ffffff"/>
    ${actorsSvg}
  </svg>`;

  const sheetBuffer = await sharp(Buffer.from(sheetSvg)).resize(1280, 720).png().toBuffer();
  await writeFile(join(outputDir, 'test_scene_05_character_sheet.png'), sheetBuffer);
  await writeFile(join(artifactDir, 'test_scene_05_character_sheet.png'), sheetBuffer);
  console.log(`Rendered: test_scene_05_character_sheet.png -> ${join(outputDir, 'test_scene_05_character_sheet.png')}`);

  console.log('Done rendering all test scenes!');
}

main().catch(err => {
  console.error('Render test error:', err);
  process.exit(1);
});
