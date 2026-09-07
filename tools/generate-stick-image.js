const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

// Register ts-node style loader for runtime compilation of TS modules
require.extensions['.ts'] = (module, filename) => {
  module._compile(
    ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    }).outputText,
    filename
  );
};

const sharp = require('sharp');
const { stickFrame } = require('../src/main/services/stick-animation.ts');

function parseArgs() {
  const args = process.argv.slice(2);
  const params = {
    setting: 'home',
    format: 'LANDSCAPE',
    output: path.join(process.cwd(), 'output', `stickman_${Date.now()}.png`),
    actors: [
      { name: 'An', action: 'read', role: 'MAIN', prop: 'book', emotion: 'happy', hair: 'none', outfit: 'hoodie' },
    ],
  };

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--setting' && args[i + 1]) params.setting = args[++i];
    else if (args[i] === '--out' && args[i + 1]) params.output = args[++i];
    else if (args[i] === '--format' && args[i + 1]) params.format = args[++i].toUpperCase();
    else if (args[i] === '--actors' && args[i + 1]) {
      const rawActors = args[++i].split(';');
      params.actors = rawActors.map((raw, idx) => {
        const defaultNames = ['An', 'Bình', 'Mai', 'Dũng', 'Tuấn'];
        return {
          name: parts[0] || defaultNames[idx % defaultNames.length],
          action: parts[1] || 'stand',
          role: parts[2] || (idx === 0 ? 'MAIN' : 'SUPPORTING'),
          prop: parts[3] || 'none',
          emotion: parts[4] || 'neutral',
          hair: parts[5] || 'short',
          outfit: parts[6] || 'plain',
          position: idx === 0 ? 'left' : idx === 1 ? 'right' : 'center',
        };
      });
    }
  }
  return params;
}

async function main() {
  const config = parseArgs();
  console.log(`🎨 Generating stickman image... Setting: ${config.setting}, Actors: ${config.actors.length}`);

  const scene = {
    setting: config.setting,
    actors: config.actors,
  };

  const colors = new Map();
  colors.set('An', '#6ba7db');

  const svgText = stickFrame(scene, 0, config.format, colors);

  const outDir = path.dirname(config.output);
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  await sharp(Buffer.from(svgText)).png().toFile(config.output);
  console.log(`✅ Stickman image saved to: ${config.output}`);
}

main().catch(err => {
  console.error('❌ Error generating stickman image:', err);
  process.exit(1);
});
