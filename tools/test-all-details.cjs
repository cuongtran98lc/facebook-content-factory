const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

require.extensions['.ts'] = (module, filename) => {
  module._compile(
    ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    }).outputText,
    filename
  );
};

const sharp = require('sharp');
const { ACTIONS, SETTINGS, stickFrame } = require('../src/main/services/stick-animation.ts');
const { HAIR, OUTFITS, EMOTIONS, PROPS, OBJECTS } = require('../src/main/services/stick-details.ts');

async function testAll() {
  console.log(`Total ACTIONS: ${ACTIONS.length}`);
  console.log(`Total SETTINGS: ${SETTINGS.length}`);
  console.log(`Total HAIR: ${HAIR.length}`);
  console.log(`Total OUTFITS: ${OUTFITS.length}`);
  console.log(`Total EMOTIONS: ${EMOTIONS.length}`);
  console.log(`Total PROPS: ${PROPS.length}`);
  console.log(`Total OBJECTS: ${OBJECTS.length}`);

  const outDir = path.join(process.cwd(), 'output', 'preview_details');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  const colors = new Map();
  colors.set('An', '#3788e5');
  colors.set('Mai', '#ef91b5');
  colors.set('Bình', '#f2ca45');
  colors.set('Sếp', '#475569');

  // Test each setting with different actions and props
  for (let i = 0; i < SETTINGS.length; i++) {
    const setting = SETTINGS[i];
    const action1 = ACTIONS[i % ACTIONS.length];
    const action2 = ACTIONS[(i + 5) % ACTIONS.length];
    const emotion1 = EMOTIONS[i % EMOTIONS.length];
    const emotion2 = EMOTIONS[(i + 3) % EMOTIONS.length];
    const prop1 = PROPS[i % PROPS.length];
    const prop2 = PROPS[(i + 4) % PROPS.length];
    const obj1 = OBJECTS[i % OBJECTS.length];
    const obj2 = OBJECTS[(i + 2) % OBJECTS.length];

    const scene = {
      setting,
      objects: [obj1, obj2],
      actors: [
        { name: 'An', action: action1, role: 'MAIN', emotion: emotion1, prop: prop1, position: 'left' },
        { name: 'Mai', action: action2, role: 'GIRLFRIEND', emotion: emotion2, prop: prop2, position: 'right' },
      ]
    };

    // Test REEL (9:16)
    const reelSvg = stickFrame(scene, 15, 'REEL', colors);
    const reelPng = await sharp(Buffer.from(reelSvg)).png().toBuffer();
    fs.writeFileSync(path.join(outDir, `${String(i + 1).padStart(2, '0')}_reel_${setting}.png`), reelPng);

    // Test LANDSCAPE (16:9)
    const landscapeSvg = stickFrame(scene, 15, 'LANDSCAPE', colors);
    const landscapePng = await sharp(Buffer.from(landscapeSvg)).png().toBuffer();
    fs.writeFileSync(path.join(outDir, `${String(i + 1).padStart(2, '0')}_land_${setting}.png`), landscapePng);

    console.log(`✅ [${i + 1}/${SETTINGS.length}] Rendered setting "${setting}" (actions: ${action1}, ${action2})`);
  }

  // Also test a scene with newly added actions specifically
  const specialActions = ['shock', 'fight', 'dance', 'sleep', 'beg', 'cheer', 'type', 'drink', 'facepalm', 'shrug'];
  for (let j = 0; j < specialActions.length; j++) {
    const act = specialActions[j];
    const scene = {
      setting: 'office',
      actors: [
        { name: 'Bình', action: act, role: 'BEST_FRIEND', emotion: 'shocked', position: 'center' }
      ]
    };
    const svg = stickFrame(scene, 30, 'REEL', colors);
    const png = await sharp(Buffer.from(svg)).png().toBuffer();
    fs.writeFileSync(path.join(outDir, `action_${act}.png`), png);
  }

  console.log('🎉 All test renders completed successfully!');
}

testAll().catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
