const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, filename);
async function main() {
 const root = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-reels-'));
 const original = Module._load;
 let created = 0;
 const prisma = { script: { findFirst: async () => ({ id: 'source', content: 'The full story.' }), create: async ({ data }) => ({ ...data, id: `reel-${++created}` }) }, $transaction: tasks => Promise.all(tasks) };
 try {
  Module._load = function(request, parent, ...args) {
   if (parent?.filename.endsWith('/services/stickman-engine.ts')) {
    if (request === './ai') return {};
    if (request === './database') return { getPrisma: () => prisma };
    if (request === './storage') return { ProjectStorageService: class { async getStudioOutputPath(project, script, file) { const dir = path.join(root, project, script); fs.mkdirSync(dir, { recursive: true }); return path.join(dir, file); } } };
   }
   return original.call(this, request, parent, ...args);
  };
  const { StickmanEngineService } = require('../src/main/services/stickman-engine.ts');
  const episode = { title: 'A secret exposed', content: Array(80).fill('story').join(' '), caption: 'A secret exposed! Watch until the end. #Shorts', description: 'A choice changes everything.', hashtags: ['#Shorts'] };
  let response = { episodes: [episode, { ...episode, title: 'The consequence', caption: 'The consequence unfolds! #Shorts' }] };
  const engine = new StickmanEngineService({ provider: () => ({ generateText: async () => JSON.stringify(response) }) });
  const result = await engine.splitReels({ projectId: 'project', scriptId: 'source', count: 2 });
  assert.equal(result.length, 2);
  assert.notEqual(result[0].outputDir, result[1].outputDir);
  for (const reel of result) {
   assert.equal(fs.readFileSync(path.join(reel.outputDir, 'script.txt'), 'utf8'), reel.content);
   assert.ok(reel.caption.includes('#Shorts'), 'reel.caption must exist');
   assert.ok(fs.readFileSync(path.join(reel.outputDir, 'publish.txt'), 'utf8').includes('[CAPTION (REELS / TIKTOK / FB)]:'));
  }
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'project', 'source', 'reels.json'))).length, 2);
  response = { episodes: [{ ...episode, content: 'Too short.' }, episode] };
  await assert.rejects(engine.splitReels({ projectId: 'project', scriptId: 'source', count: 2 }), /độ dài/);
  assert.equal(created, 2, 'Invalid batch must not create scripts');
  await assert.rejects(engine.splitReels({ projectId: 'project', scriptId: 'source', count: 20 }));
  console.log('PASS: episode splitting, separate scripts/metadata, manifest, count and word validation before writes');
 } finally { Module._load = original; fs.rmSync(root, { recursive: true, force: true }); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
