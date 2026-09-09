const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const sharp = require('sharp');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText, filename);
const { ACTIONS, stickFrame, parseStickScenes } = require('../src/main/services/stick-animation.ts');

async function main() {
  const scenes = parseStickScenes(JSON.stringify({ scenes: [
    { actors: [{ name: 'Emma', role: 'GIRLFRIEND', action: 'stand', outfit: 'jacket' }] },
    { actors: [{ name: 'Emma', role: 'MAIN', hair: 'short', action: 'phone', prop: 'phone' }] },
  ] }), 2);
  assert.equal(scenes[1].actors[0].role, 'GIRLFRIEND');
  assert.equal(scenes[1].actors[0].hair, 'ponytail');
  assert.equal(scenes[1].actors[0].prop, 'phone');
  assert.equal(scenes[1].actors[0].outfit, 'jacket', 'Wardrobe persists when the next scene omits it');
  const frame = (actor, time = 0, format = 'LANDSCAPE') => stickFrame({ setting: 'street', actors: [{ name: 'Alex', role: 'MAIN', action: 'stand', ...actor }] }, time, format, new Map());
  const main = frame({});
  assert.ok(main.includes('fill="#e31b23"'), 'Main retains the red tie');
  assert.ok(main.includes('r="52" fill="#fff"'), 'Circular white head');
  assert.ok(!main.includes('#3788e5'), 'No forced blue hoodie');
  assert.equal(frame({}, 0), frame({}, 30), 'Standing actors do not float up and down');
  assert.notEqual(frame({ action: 'walk' }, 0), frame({ action: 'walk' }, 30), 'Walking has a changing gait');
  assert.ok(frame({ action: 'walk' }, 30).includes('translate(480 410.4)'), 'Walking stance foot stays at floor height');
  assert.ok(frame({ facing: 'left' }).includes('scale(-1 1)'), 'Left-facing hands and props mirror together');
  assert.ok(frame({ facing: 'right' }).includes('scale(1 1)'));
  assert.ok(frame({ outfit: 'doctor_coat' }).includes('#64748b'), 'Explicit story clothing is respected');
  for (const action of ACTIONS) {
    for (const format of ['LANDSCAPE', 'SQUARE', 'REEL']) {
      const svg = frame({ action }, 30, format);
      assert.ok(!/NaN|undefined/.test(svg), `${action} must have valid coordinates`);
      const { info } = await sharp(Buffer.from(svg)).png().toBuffer({ resolveWithObject: true });
      assert.equal(info.width / info.height, format === 'LANDSCAPE' ? 16 / 9 : format === 'REEL' ? 9 / 16 : 1);
    }
  }
  console.log(`PASS: cast identity, appearance overrides, grounded idle, gait, facing and ${ACTIONS.length * 3} rasterized action/format combinations`);
}
main().catch(error => { console.error(error); process.exitCode = 1; });
