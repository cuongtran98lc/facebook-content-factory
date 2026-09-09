const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const Module = require('node:module');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, filename);
const original = Module._load;
Module._load = function(request, parent, ...args) {
  if (parent?.filename.endsWith('/services/stickman-engine.ts') && ['./ai', './database', './storage'].includes(request)) return {};
  return original.call(this, request, parent, ...args);
};
const { StickmanEngineService } = require('../src/main/services/stickman-engine.ts');
Module._load = original;
const idea = { recommendedFormat: 'LONG', workingTitle: 'A secret', premise: 'A discovery', conflict: 'A choice', twist: 'The truth', ending: 'Resolution', hook: 'Who knew?' };
const chapters = n => JSON.stringify(Array.from({ length: n }, (_, i) => ({ id: `beat_${i}`, label: `Chapter ${i}`, narration: 'Too short.' })));
async function main() {
  let calls = 0;
  const engine = new StickmanEngineService({ provider: () => ({ generateText: async options => {
    calls++;
    if (options.json) { assert.ok(options.prompt.includes('COMPLETE spoken story')); return chapters(10); }
    return Array(120).fill('story').join(' ');
  } }) });
  const result = await engine.generateScript({ idea, format: 'LONG', targetMinutes: 8 });
  assert.equal(result.length, 10);
  assert.equal(calls, 11);
  assert.equal(result.reduce((sum, b) => sum + b.narration.split(' ').length, 0), 1200);
  assert.notEqual(result[0].timeRange, result[9].timeRange);
  let failures = 0;
  const failing = new StickmanEngineService({ provider: () => ({ generateText: async options => { failures++; return options.json ? chapters(10) : 'Still short.'; } }) });
  await assert.rejects(failing.generateScript({ idea, format: 'LONG', targetMinutes: 8 }), /Chương 1/);
  assert.equal(failures, 3);
  const short = new StickmanEngineService({ provider: () => ({ generateText: async () => chapters(7) }) });
  assert.equal((await short.generateScript({ idea, format: 'SHORT' })).length, 7);
  console.log('PASS: short outlines expanded into full long narration, bounded repair, rejection of undersized chapters, chapter timing and separate Short path');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
