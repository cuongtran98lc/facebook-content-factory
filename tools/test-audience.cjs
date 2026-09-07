const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText, filename);
const { audiencePrompt } = require('../src/shared/audience.ts');
const { PublishingMetadataService } = require('../src/main/services/video-metadata.ts');
async function main() {
  assert.match(audiencePrompt(), /vi-VN/);
  assert.throws(() => audiencePrompt({ targetMarket: 'invalid' }));
  const target = { key: 'test', mode: 'STORY_SHORT_9_16', storyTitle: 'The hidden letter', content: 'Alex finds a letter behind the door and begins looking for its owner.', part: 1, totalParts: 2, targetMarket: 'US', contentLanguage: 'en-US' };
  const fallback = new PublishingMetadataService({ provider() { throw new Error('offline'); } });
  const [english, vietnamese] = await fallback.generate([target, { ...target, contentLanguage: 'vi-VN', targetMarket: 'VN' }]);
  assert.match(english.title, /Part 1\/2/);
  assert.doesNotMatch(english.description, /Truyen|KeChuyen|câu chuyện/);
  assert.match(vietnamese.title, /Phần 1\/2/);
  const ai = new PublishingMetadataService({ provider: () => ({ name: 'fake', generateText: async ({ prompt }) => {
    assert.match(prompt, /en-US/);
    return JSON.stringify({ items: [{ key: 'item-1', title: 'The hidden letter — Part 9/9', description: 'Alex finds a mysterious letter and searches for its owner. #Story #Shorts #Mystery' }] });
  } }) });
  const [result] = await ai.generate([target]);
  assert.equal(result.source, 'AI');
  assert.match(result.title, /Part 1\/2/);
  assert.doesNotMatch(result.title, /9\/9/);
  console.log('PASS: audience validation, default Vietnamese, English fallback and AI metadata part labels');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
