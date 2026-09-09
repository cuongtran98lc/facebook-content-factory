const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');

require.extensions['.ts'] = (module, filename) =>
  module._compile(
    ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }
    }).outputText,
    filename
  );

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'caption-test-'));
  const original = Module._load;
  try {
    Module._load = function(request, parent, ...args) {
      if (parent?.filename.endsWith('/services/stickman-engine.ts')) {
        if (request === './ai') return {};
        if (request === './database') return {
          getPrisma: () => ({
            script: {
              findFirst: async () => ({
                id: 'source-script',
                content: 'Full script content for testing stickman story caption generation.'
              })
            }
          })
        };
        if (request === './storage') {
          return {
            ProjectStorageService: class {
              async getStudioOutputPath(project, script, file) {
                const dir = path.join(root, project, script);
                fs.mkdirSync(dir, { recursive: true });
                return path.join(dir, file);
              }
            }
          };
        }
      }
      return original.call(this, request, parent, ...args);
    };

    const { StickmanEngineService } = require('../src/main/services/stickman-engine.ts');

    // 1. Test generatePackage with AI caption
    const fakeAIResponse = {
      title: 'The Hidden Truth',
      alternativeTitles: ['Mystery: What was behind the wall?'],
      caption: '🔥 He thought he could lie to my face until I checked the footage! Watch what happened next. #shorts #stickman #storytime',
      description: 'Full story description for YouTube SEO...',
      hashtags: ['#shorts', '#stickman', '#storytime', '#betrayal'],
      thumbnailConcept: 'Shocked stickman looking at phone',
      thumbnailText: 'HE KNEW',
      thumbnailPrompt: 'doodle thumbnail',
      cta: 'Subscribe for part 2!',
      relatedVideoIdeas: ['Revenge chapter']
    };

    const engine = new StickmanEngineService({
      provider: () => ({
        generateText: async () => JSON.stringify(fakeAIResponse)
      })
    });

    const mockIdea = {
      id: 'idea-1',
      workingTitle: 'The Hidden Truth',
      premise: 'A friend discovers betrayal.',
      pillarId: 'betrayal',
      targetMarket: 'US',
      targetAudience: 'Teens',
      recommendedFormat: 'SHORT',
      mainCharacter: 'Alex',
      supportingCharacters: ['Ben'],
      relationship: 'Best friend',
      setting: 'Home',
      conflict: 'Stolen laptop',
      emotionalTrigger: 'Shock',
      twist: 'Found in room',
      ending: 'Confrontation',
      hook: 'I trusted him with my keys.',
      whyItMayWork: 'Relatable betrayal',
      originalityAngle: 'Smart tech evidence',
      estimatedComplexity: 'LOW',
      score: { overall: 90, hookStrength: 90, curiosity: 90, emotionalIntensity: 90, relatability: 90, twistPotential: 90, visualPotential: 90, seriesPotential: 90 }
    };

    const pkg = await engine.generatePackage({
      idea: mockIdea,
      selectedHook: 'I trusted him with my keys.',
      beats: [
        { id: 'b1', timeRange: '0-5s', label: 'HOOK', narration: 'Full script content for testing stickman story caption generation.', action: 'talk', emotion: 'shock', camera: 'close-up' }
      ],
      scenes: []
    });

    assert.ok(pkg.caption, 'pkg.caption must be non-empty');
    assert.ok(pkg.caption.includes('He thought he could lie'), 'pkg.caption should contain generated text');
    assert.ok(pkg.caption.includes('#shorts'), 'pkg.caption should contain hashtags');

    // 2. Test saveOutput saves caption to publish.txt
    const outputDir = await engine.saveOutput({
      projectId: 'proj-1',
      scriptId: 'source-script',
      pkg
    });

    const publishContent = fs.readFileSync(path.join(outputDir, 'publish.txt'), 'utf8');
    assert.ok(publishContent.includes('[CAPTION (REELS / TIKTOK / FB)]:'), 'publish.txt must contain caption section header');
    assert.ok(publishContent.includes('He thought he could lie'), 'publish.txt must contain the actual caption');

    const contentPackageJson = JSON.parse(fs.readFileSync(path.join(outputDir, 'content-package.json'), 'utf8'));
    assert.equal(contentPackageJson.caption, pkg.caption, 'content-package.json must persist caption');

    console.log('PASS: generatePackage caption, saveOutput publish.txt & content-package.json validation');
  } finally {
    Module._load = original;
    fs.rmSync(root, { recursive: true, force: true });
  }
}

main().catch(err => {
  console.error(err);
  process.exitCode = 1;
});
