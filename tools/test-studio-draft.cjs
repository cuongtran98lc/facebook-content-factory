const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, filename);
const { studioDraftKey, readStudioDraft, writeStudioDraft } = require('../src/renderer/src/lib/studio-draft.ts');
const entries = new Map();
const storage = { getItem: key => entries.get(key) ?? null, setItem: (key, value) => entries.set(key, value) };
const a = studioDraftKey('project-a');
const b = studioDraftKey('project-b');
const draft = { step: 'script', seedPremise: 'A secret', selectedHook: 'Why?',
  beats: [{ id: 'one', narration: 'Edited narration', locked: true }], scenes: [],
  workProgress: { script: { status: 'done', percent: 100 }, audio: { status: 'running', percent: 40 } },
  importedScript: { projectId: 'project-a', scriptId: 'saved-script' },
};
writeStudioDraft(storage, a, draft);
writeStudioDraft(storage, b, { step: 'ideas', seedPremise: 'Different story' });
const restored = readStudioDraft(storage, a);
assert.equal(restored.step, 'script');
assert.deepEqual(restored.beats, draft.beats);
assert.deepEqual(restored.importedScript, draft.importedScript);
assert.equal(restored.workProgress.script.status, 'done');
assert.equal(restored.workProgress.audio.status, 'interrupted');
assert.equal(restored.workProgress.audio.percent, 40);
assert.equal(readStudioDraft(storage, b).seedPremise, 'Different story');
assert.notEqual(studioDraftKey(null), studioDraftKey('unassigned'));
assert.deepEqual(readStudioDraft(storage, studioDraftKey(null)), {});
entries.set(a, '{broken json');
assert.throws(() => readStudioDraft(storage, a));
assert.equal(entries.get(a), '{broken json', 'Read failure must not destroy the saved data');
entries.set(a, JSON.stringify({ version: 1, data: { beats: 'invalid' } }));
assert.throws(() => readStudioDraft(storage, a));
assert.throws(() => writeStudioDraft({ setItem() { throw new Error('Storage full'); } }, a, draft), /Storage full/);
console.log('PASS: draft round trip, project isolation, edited/locked beats, script reuse, interrupted recovery and storage failures');
