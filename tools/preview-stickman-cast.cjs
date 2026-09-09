// Regenerate the in-app motion sample from the production SVG renderer.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const ts = require('typescript');
const sharp = require('sharp');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText, filename);
const { stickFrame } = require('../src/main/services/stick-animation.ts');
const scene = { setting: 'street', actors: [
  { name: 'Alex', role: 'MAIN', action: 'walk', emotion: 'smug', prop: 'briefcase', position: 'left', facing: 'right' },
  { name: 'Emma', role: 'GIRLFRIEND', action: 'angry', emotion: 'angry', position: 'center', facing: 'left' },
  { name: 'Noah', role: 'BEST_FRIEND', action: 'talk', emotion: 'worried', position: 'right', facing: 'left' },
] };
async function main() {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'cast-preview-'));
  const assets = path.resolve(__dirname, '../src/renderer/src/assets');
  fs.mkdirSync(assets, { recursive: true });
  try {
    for (let frame = 0; frame < 60; frame++) {
      await sharp(Buffer.from(stickFrame(scene, frame * 2, 'LANDSCAPE', new Map())))
        .png().toFile(path.join(folder, `${String(frame).padStart(3, '0')}.png`));
    }
    fs.copyFileSync(path.join(folder, '015.png'), path.join(folder, 'review.png'));
    const ffmpeg = ['/opt/homebrew/opt/ffmpeg-full/bin/ffmpeg', '/usr/local/opt/ffmpeg-full/bin/ffmpeg', process.env.FFMPEG_PATH].find(binary => binary && fs.existsSync(binary)) || 'ffmpeg';
    execFileSync(ffmpeg, ['-y', '-framerate', '30', '-i', path.join(folder, '%03d.png'),
      '-c:v', 'libwebp_anim', '-loop', '0', '-quality', '80', path.join(assets, 'stickman-cast-preview.webp')], { stdio: 'pipe' });
    // Keep a review frame in the project's output folder.
    const output = path.resolve(__dirname, '../output');
    fs.mkdirSync(output, { recursive: true });
    fs.copyFileSync(path.join(folder, 'review.png'), path.join(output, 'stickman-cast-review.png'));
    console.log('Generated cast preview from 60 production frames.');
  } finally { fs.rmSync(folder, { recursive: true, force: true }); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
