// Run: node tools/test-stick-animation.cjs [--render]
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const ts = require('typescript');
const { execFileSync } = require('node:child_process');
require.extensions['.ts'] = (module, filename) => {
  module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText, filename);
};
const {
  storySections,
  parseStickScenes,
  stickFrame,
  renderStickAnimation,
  stickConceptFrame,
  stickConceptPrompt,
  parseConceptData
} = require('../src/main/services/stick-animation.ts');
const { probeDuration, renderLoopedVideo, extractVideoFrame } = require('../src/main/services/ffmpeg.ts');
const sharp = require('sharp');

async function main() {
  const story = 'An chạy về nhà. Mẹ đang khóc.\nAn ngồi xuống cạnh mẹ.';
  assert.equal(storySections(story).join(' '), story.replace(/\n/g, ' '));
  assert.throws(() => storySections('  '));
  const scenes = [
    { index: 0, setting: 'street', actors: [{ name: 'An', action: 'run' }] },
    { index: 1, setting: 'home', actors: [{ name: 'An', action: 'sit' }, { name: 'Mẹ', action: 'cry' }] },
  ];
  const parsed = parseStickScenes(JSON.stringify({ scenes }), 2);
  assert.equal(parseStickScenes(JSON.stringify({ scenes }), 3).length, 3, 'Auto-pad missing scenes');
  assert.throws(() => parseStickScenes('invalid json string', 1));
  assert.throws(() => parseStickScenes(JSON.stringify({ scenes: [] }), 1));
  const colors = new Map([['An', '#334155'], ['Mẹ', '#c45b50']]);
  assert.notEqual(stickFrame(parsed[0], 0, 'LANDSCAPE', colors), stickFrame(parsed[0], 3, 'LANDSCAPE', colors));
  const escaped = stickFrame({ setting: 'home', actors: [{ name: '<&', action: 'stand' }] }, 0, 'REEL', colors);
  assert.ok(escaped.includes('&lt;&amp;'));
  for (const format of ['LANDSCAPE', 'SQUARE', 'REEL']) {
    const info = await sharp(Buffer.from(stickFrame(parsed[1], 0, format, colors))).metadata();
    assert.equal(info.width / info.height, format === 'LANDSCAPE' ? 16 / 9 : format === 'REEL' ? 9 / 16 : 1);
  }
  const detailed = parseStickScenes(JSON.stringify({ scenes: [
    { index: 0, setting: 'home', objects: ['table', 'bookshelf'], actors: [{ name: 'An', action: 'read', hair: 'short', age: 'child', outfit: 'uniform', emotion: 'worried', prop: 'book', position: 'left', facing: 'right' }] },
    { index: 1, setting: 'hospital', objects: ['bed'], actors: [{ name: 'An', action: 'carry', hair: 'long', age: 'adult', outfit: 'shirt', emotion: 'sad', prop: 'flowers', position: 'right', facing: 'left' }] }
  ] }), 2);
  assert.equal(detailed[1].actors[0].hair, 'short', 'Identity hair must be preserved across scenes');
  assert.equal(detailed[1].actors[0].age, 'child');
  assert.equal(detailed[1].actors[0].prop, 'flowers', 'Props may change with the story');
  assert.equal(parseStickScenes(JSON.stringify({ scenes: [{ ...scenes[0], objects: ['execute'] }] }), 1)[0].objects?.length, 0);
  assert.equal(parseStickScenes(JSON.stringify({ scenes: [{ ...scenes[0], actors: [{ name: 'An', action: 'read', hair: '<svg>' }] }] }), 1)[0].actors[0].hair, 'none');
  for (const scene of detailed) for (const format of ['LANDSCAPE', 'REEL']) {
    await sharp(Buffer.from(stickFrame(scene, 20, format, colors))).png().toBuffer();
  }
  assert.notEqual(stickFrame(detailed[0], 20, 'LANDSCAPE', colors), stickFrame({ ...detailed[0], actors: [{ name: 'An', action: 'read' }] }, 20, 'LANDSCAPE', colors));
  const { ROLE_COLORS } = require('../src/main/services/stick-details.ts');
  for (const [role, color] of Object.entries(ROLE_COLORS)) {
    const svg = stickFrame({ setting: 'home', actors: [{ name: 'Role', action: 'stand', role, outfit: 'suit' }] }, 0, 'LANDSCAPE', colors);
    assert.ok(svg.includes(`fill="${color}"`), `${role} must have its fixed hoodie color`);
    assert.ok(svg.includes('fill="#222222"'), 'Recurring characters must have a black body');
    await sharp(Buffer.from(svg)).png().toBuffer();
  }
  const { buildIdeasPrompt, IDEA_THEMES, IDEA_SYSTEM_PROMPT } = require('../src/main/services/story-prompts.ts');
  assert.equal(IDEA_THEMES.length, 10);
  const prompt = buildIdeasPrompt({ count: 10, niche: 'đời sống', topic: 'tự chọn' });
  for (const category of IDEA_THEMES) assert.ok(prompt.includes(category));
  assert.ok(prompt.includes('"index":9,"category":"What if / Thế giới giả định"'));
  assert.ok(IDEA_SYSTEM_PROMPT.includes('không cần phản diện'));
  const { rulesForDuration, SHORT_RULES, MEDIUM_RULES, LONG_RULES } = require('../src/main/services/stickman-knowledge.ts');
  assert.equal(rulesForDuration(.25), SHORT_RULES);
  assert.equal(rulesForDuration(1), SHORT_RULES);
  assert.equal(rulesForDuration(3), MEDIUM_RULES);
  assert.equal(rulesForDuration(15), LONG_RULES);
  const richer = parseStickScenes(JSON.stringify({ scenes: [{ index: 0, setting: 'office', overlay: { kind: 'rule', label: 'CTRL+Z < 3 lần' }, actors: [{ name: 'Sếp', role: 'SUPPORTING', archetype: 'boss', trait: 'confident', action: 'carry', prop: 'laptop' }] }] }), 1);
  const richerSvg = stickFrame(richer[0], 10, 'REEL', colors);
  assert.ok(richerSvg.includes('CTRL+Z &lt; 3 lần'));
  await sharp(Buffer.from(richerSvg)).png().toBuffer();
  assert.equal(parseStickScenes(JSON.stringify({ scenes: [{ ...scenes[0], overlay: { kind: 'execute', label: 'bad' } }] }), 1)[0].overlay, undefined);

  // Concept 1: PROBLEM_STATE test
  const problemPrompt = stickConceptPrompt('PROBLEM_STATE', 'Alex faces bankruptcy after taking loan');
  assert.ok(problemPrompt.includes('PROBLEM_STATE'));
  assert.ok(problemPrompt.includes('clue'));
  assert.ok(problemPrompt.includes('dangerTag'));
  const problemData = parseConceptData(JSON.stringify({
    concept: 'PROBLEM_STATE',
    actor: { name: 'Alex', action: 'facepalm', emotion: 'shocked', outfit: 'suit', prop: 'phone' },
    setting: 'office',
    clue: 'OVERDUE: $50,000',
    dangerTag: 'FINANCIAL CRISIS'
  }), 'PROBLEM_STATE');
  assert.equal(problemData.concept, 'PROBLEM_STATE');
  assert.equal(problemData.actor.name, 'Alex');
  assert.equal(problemData.clue, 'OVERDUE: $50,000');
  for (const format of ['LANDSCAPE', 'REEL']) {
    const svg = stickConceptFrame('PROBLEM_STATE', problemData, 0, format, colors, true);
    assert.ok(svg.includes('OVERDUE: $50,000'));
    assert.ok(svg.includes('FINANCIAL CRISIS'));
    const info = await sharp(Buffer.from(svg)).metadata();
    assert.equal(info.width / info.height, format === 'LANDSCAPE' ? 16 / 9 : 9 / 16);
  }

  // Concept 2: SPLIT_SCREEN test
  const splitPrompt = stickConceptPrompt('SPLIT_SCREEN', 'Before vs After lottery');
  assert.ok(splitPrompt.includes('SPLIT_SCREEN'));
  assert.ok(splitPrompt.includes('leftTitle'));
  assert.ok(splitPrompt.includes('rightTitle'));
  const splitData = parseConceptData(JSON.stringify({
    concept: 'SPLIT_SCREEN',
    leftTitle: 'EXPECTATION',
    rightTitle: 'REALITY',
    leftActor: { name: 'Alex', action: 'cheer', emotion: 'happy', prop: 'money_pile' },
    rightActor: { name: 'Alex', action: 'beg', emotion: 'crying', prop: 'contract' },
    leftSetting: 'office',
    rightSetting: 'street'
  }), 'SPLIT_SCREEN');
  assert.equal(splitData.concept, 'SPLIT_SCREEN');
  assert.equal(splitData.leftTitle, 'EXPECTATION');
  assert.equal(splitData.rightTitle, 'REALITY');
  for (const format of ['LANDSCAPE', 'REEL']) {
    const svg = stickConceptFrame('SPLIT_SCREEN', splitData, 0, format, colors, true);
    assert.ok(svg.includes('EXPECTATION'));
    assert.ok(svg.includes('REALITY'));
    assert.ok(svg.includes('VS'));
    const info = await sharp(Buffer.from(svg)).metadata();
    assert.equal(info.width / info.height, format === 'LANDSCAPE' ? 16 / 9 : 9 / 16);
  }

  // Concept 3: HIGH_STAKES test
  const stakesPrompt = stickConceptPrompt('HIGH_STAKES', 'Sign contract or walk away');
  assert.ok(stakesPrompt.includes('HIGH_STAKES'));
  assert.ok(stakesPrompt.includes('leftChoice'));
  assert.ok(stakesPrompt.includes('rightChoice'));
  const stakesData = parseConceptData(JSON.stringify({
    concept: 'HIGH_STAKES',
    centerActor: { name: 'Alex', action: 'shrug', emotion: 'worried' },
    leftChoice: { title: 'SIGN CONTRACT', stake: 'Lose 50% Equity', prop: 'contract', color: '#ef4444' },
    rightChoice: { title: 'WALK AWAY', stake: 'Immediate Bankruptcy', prop: 'money_pile', color: '#3b82f6' },
    dilemmaQuestion: 'WHAT WOULD YOU CHOOSE?'
  }), 'HIGH_STAKES');
  assert.equal(stakesData.concept, 'HIGH_STAKES');
  assert.equal(stakesData.leftChoice.title, 'SIGN CONTRACT');
  assert.equal(stakesData.dilemmaQuestion, 'WHAT WOULD YOU CHOOSE?');
  for (const format of ['LANDSCAPE', 'REEL']) {
    const svg = stickConceptFrame('HIGH_STAKES', stakesData, 0, format, colors, true);
    assert.ok(svg.includes('SIGN CONTRACT'));
    assert.ok(svg.includes('Lose 50% Equity'));
    assert.ok(svg.includes('WALK AWAY'));
    assert.ok(svg.includes('WHAT WOULD YOU CHOOSE?'));
    const info = await sharp(Buffer.from(svg)).metadata();
    assert.equal(info.width / info.height, format === 'LANDSCAPE' ? 16 / 9 : 9 / 16);
  }

  console.log('PASS: Concept 1 (Problem State), Concept 2 (Split-Screen), Concept 3 (High-Stakes) prompts, parsing, and rendering');
  console.log('PASS: 10-pillar taxonomy, format routing, supporting cast and escaped overlays');
  console.log('PASS: per-scene details, character continuity, prop validation and detailed SVG rendering');
  console.log('PASS: storyboard validation, text order, XML escaping, motion and aspect ratios');
  if (!process.argv.includes('--render')) return;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'stick-test-'));
  try {
    const output = path.join(root, 'animation.mp4');
    const audio = path.join(root, 'audio.wav');
    const ffmpeg = ['/opt/homebrew/opt/ffmpeg-full/bin/ffmpeg', '/usr/local/opt/ffmpeg-full/bin/ffmpeg', process.env.FFMPEG_PATH].find(binary => binary && fs.existsSync(binary)) || 'ffmpeg';
    execFileSync(ffmpeg, ['-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=4', audio], { stdio: 'ignore' });
    await renderStickAnimation(parsed, ['An chạy về nhà.', 'Mẹ khóc ở nhà.'], 4, 'LANDSCAPE', output, () => {}, audio);
    assert.ok(Math.abs(await probeDuration(output) - 4) < .1);
    const streams = file => JSON.parse(execFileSync(ffmpeg.replace(/ffmpeg$/, 'ffprobe'), ['-v', 'error', '-show_streams', '-of', 'json', file], { encoding: 'utf8' })).streams;
    assert.ok(streams(output).some(stream => stream.codec_type === 'audio'), 'Preview must contain narration');
    assert.equal(streams(output).find(stream => stream.codec_type === 'video').r_frame_rate, '60/1');
    const clipped = path.join(root, 'clip.mp4');
    await renderLoopedVideo({ backgroundPath: output, backgroundStartSeconds: 2, audioPath: audio, audioStartSeconds: 2, audioDurationSeconds: 1, outputPath: clipped, format: 'LANDSCAPE', fitMode: 'FIT', frameRate: 60 });
    assert.ok(Math.abs(await probeDuration(clipped) - 1) < .1);
    assert.equal(streams(clipped).find(stream => stream.codec_type === 'video').r_frame_rate, '60/1');
    await extractVideoFrame(output, path.join(root, 'expected.png'), 2);
    await extractVideoFrame(clipped, path.join(root, 'actual.png'), 0);
    const pixels = async name => sharp(path.join(root, name)).resize(96, 54).removeAlpha().raw().toBuffer();
    const expected = await pixels('expected.png');
    const actual = await pixels('actual.png');
    const difference = expected.reduce((sum, value, index) => sum + Math.abs(value - actual[index]), 0) / expected.length;
    assert.ok(difference < 5, `Short must start at the second scene, pixel difference: ${difference}`);
    console.log('PASS: real FFmpeg animation, duration, narration mix and second-scene seeking');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
