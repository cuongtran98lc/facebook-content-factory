const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, filename);
const { createAssSubtitles } = require('../src/main/services/subtitles.ts');
const { burnVideoCaptions, probeDuration } = require('../src/main/services/ffmpeg.ts');
async function main() {
 const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-captions-'));
 const ffmpeg = '/opt/homebrew/opt/ffmpeg-full/bin/ffmpeg';
 try {
  const video = path.join(dir, 'input.mp4');
  const output = path.join(dir, 'captioned.mp4');
  const subtitle = path.join(dir, 'captions.ass');
  fs.writeFileSync(subtitle, createAssSubtitles({ text: 'This is an English caption. Subscribe for more stories.', totalDuration: 2, format: 'REEL' }));
  execFileSync(ffmpeg, ['-y', '-f', 'lavfi', '-i', 'color=black:s=270x480:r=60:d=2', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', '-c:v', 'libx264', '-c:a', 'aac', '-shortest', video], { stdio: 'pipe' });
  await burnVideoCaptions(video, subtitle, output, 2);
  assert.ok(Math.abs(await probeDuration(output) - 2) < .1);
  const audio = file => execFileSync(ffmpeg, ['-v', 'error', '-i', file, '-map', '0:a:0', '-c:a', 'copy', '-f', 'adts', '-']);
  assert.deepEqual(audio(output), audio(video), 'Narration packets must stay unchanged');
  const pixels = execFileSync(ffmpeg, ['-v', 'error', '-ss', '0.5', '-i', output, '-frames:v', '1', '-pix_fmt', 'gray', '-f', 'rawvideo', '-']);
  assert.ok(pixels.some(value => value > 150), 'Caption must be visible on the black video');
  console.log('PASS: actual FFmpeg caption burn, visible English text, duration and unchanged audio');
 } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
