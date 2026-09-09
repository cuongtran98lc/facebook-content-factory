const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText, filename);
async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-output-test-'));
  const original = Module._load;
  try {
    Module._load = function(request, parent, ...rest) {
      if (parent?.filename.endsWith('/services/storage.ts')) {
        if (request === './paths') return { getOutputRoot: () => root, getStorageRoot: () => path.join(root, 'internal') };
        if (request === './database') return { getPrisma: () => ({ project: { findUniqueOrThrow: async () => ({ id: 'project-a', name: 'My Story' }) } }) };
      }
      return original.call(this, request, parent, ...rest);
    };
    const { ProjectStorageService } = require('../src/main/services/storage.ts');
    const storage = new ProjectStorageService();
    const video = await storage.getStudioOutputPath('project-a', 'script-a', 'videos', 'take-1.mp4');
    assert.equal(video, path.join(root, 'stickman-studio', 'project-a', 'script-a', 'videos', 'take-1.mp4'));
    assert.ok(fs.statSync(path.dirname(video)).isDirectory());
    assert.notEqual(video, await storage.getStudioOutputPath('project-a', 'script-b', 'videos', 'take-1.mp4'));
    const standard = await storage.getOutputPath('project-a', 'audio', 'story.mp3');
    assert.ok(!standard.includes('stickman-studio'));
    await assert.rejects(storage.getStudioOutputPath('../outside', 'script-a', 'file'));
    await assert.rejects(storage.getStudioOutputPath('project-a', 'script-a', '../../../../outside'));
    console.log('PASS: dedicated Studio output, script isolation, directory creation, normal output unchanged and traversal rejection');
  } finally { Module._load = original; fs.rmSync(root, { recursive: true, force: true }); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
