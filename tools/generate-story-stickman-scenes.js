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
const { CodexCliService } = require('../src/main/services/ai/codex-cli.ts');
const { storySections, stickPrompt, parseStickScenes, stickFrame } = require('../src/main/services/stick-animation.ts');

function parseArgs() {
  const args = process.argv.slice(2);
  let storyText = '';
  let format = 'LANDSCAPE';
  let outDir = path.join(process.cwd(), 'output', `story_scenes_${Date.now()}`);
  let useCodex = true;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--story' && args[i + 1]) storyText = args[++i];
    else if (args[i] === '--file' && args[i + 1]) storyText = fs.readFileSync(args[++i], 'utf8');
    else if (args[i] === '--out' && args[i + 1]) outDir = args[++i];
    else if (args[i] === '--format' && args[i + 1]) format = args[++i].toUpperCase();
    else if (args[i] === '--no-codex') useCodex = false;
  }

  if (!storyText.trim()) {
    storyText = `Ngày hôm đó, tôi trở về căn nhà cũ và thấy mẹ đang ngồi chờ bên mâm cơm.
Anh cả bước vào vẻ mặt hậm hực, yêu cầu chia mảnh đất ông bà để lại.
Mẹ không nói gì, chỉ lặng lẽ mở chiếc rương gỗ cũ lấy ra tờ di chúc.
Bất ngờ, di chúc ghi rõ toàn bộ đất đai được sang tên cho người con nuôi ngoan hiền.`;
  }

  return { storyText, format, outDir, useCodex };
}

async function main() {
  const { storyText, format, outDir, useCodex } = parseArgs();
  console.log('📜 Storyboard Scene Generator CLI');
  console.log(`📁 Target Output Directory: ${outDir}`);

  const sections = storySections(storyText);
  console.log(`✂️ Story split into ${sections.length} sections.`);

  let scenes = [];
  if (useCodex) {
    try {
      console.log('🤖 Invoking Codex CLI for storyboard analysis...');
      const codex = new CodexCliService();
      const prompt = stickPrompt(sections);
      const rawJson = await codex.generateText({ json: true, prompt });
      scenes = parseStickScenes(rawJson, sections.length);
      console.log('✅ Codex CLI parsed scenes successfully.');
    } catch (err) {
      console.warn('⚠️ Codex CLI unavailable or failed, falling back to smart scene heuristic:', err.message);
      scenes = fallbackScenes(sections);
    }
  } else {
    scenes = fallbackScenes(sections);
  }

  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  const colors = new Map();
  colors.set('An', '#6ba7db');
  colors.set('Mẹ', '#a27025');
  colors.set('Anh cả', '#c45b50');

  const generatedFiles = [];
  for (let i = 0; i < scenes.length; i++) {
    const scene = scenes[i];
    const sectionText = sections[i];
    const fileName = `scene_${String(i + 1).padStart(2, '0')}_${scene.setting}.png`;
    const filePath = path.join(outDir, fileName);

    const svgText = stickFrame(scene, 0, format, colors);
    await sharp(Buffer.from(svgText)).png().toFile(filePath);

    generatedFiles.push({ index: i + 1, file: fileName, path: filePath, sectionText, scene });
    console.log(`🖼️ Scene ${i + 1}/${scenes.length} saved: ${fileName} (${scene.setting})`);
  }

  const manifestPath = path.join(outDir, 'scenes_manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify({ sections, scenes, generatedFiles }, null, 2));

  console.log(`\n🎉 Success! Generated ${generatedFiles.length} stickman scene images at: ${outDir}`);
}

function fallbackScenes(sections) {
  const settingsList = ['home', 'home', 'home', 'home', 'street', 'park'];
  return sections.map((sec, idx) => {
    let setting = settingsList[idx % settingsList.length];
    let actors = [
      { name: 'Mẹ', action: 'sit', role: 'SUPPORTING', hair: 'short', outfit: 'plain', emotion: 'neutral', position: 'left' },
      { name: 'An', action: 'stand', role: 'MAIN', hair: 'none', outfit: 'hoodie', emotion: 'worried', position: 'center' },
    ];
    if (idx === 1) {
      actors.push({ name: 'Anh cả', action: 'angry', role: 'SUPPORTING', hair: 'short', outfit: 'plain', emotion: 'angry', position: 'right' });
    }
    return { setting, actors };
  });
}

main().catch(err => {
  console.error('❌ Error generating story stickman scenes:', err);
  process.exit(1);
});
