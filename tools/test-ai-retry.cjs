const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText, filename);
const { RetryingAIProvider, AIRequestError, retryAfterMs } = require('../src/main/services/ai/retry.ts');
const { GeminiProvider } = require('../src/main/services/ai/gemini.ts');
const overload = 'This model is currently experiencing high demand. Spikes in demand are usually temporary. Please try again later.';

async function main() {
  let calls = 0;
  const waits = [];
  const options = { prompt: 'Generate ideas', json: true };
  const provider = new RetryingAIProvider({ name: 'antigravity-cli', async generateText(input) {
    assert.equal(input, options);
    if (++calls < 3) throw new Error(overload);
    return '[{"title":"Idea"}]';
  } }, async ms => { waits.push(ms); }, () => 0);
  assert.equal(await provider.generateText(options), '[{"title":"Idea"}]');
  assert.equal(calls, 3);
  assert.deepEqual(waits, [2000, 4000]);
  calls = 0;
  const failing = error => new RetryingAIProvider({ name: 'gemini', async generateText() { calls++; throw error; } }, async () => {}, () => 0);
  await assert.rejects(failing(new Error(overload)).generateText(options), /sau 3 lần gọi/);
  assert.equal(calls, 3);
  for (const error of [new Error('Invalid API key'), new AIRequestError('Quota exceeded', 429), new Error('Invalid JSON'), new AIRequestError('Permission denied', 403)]) {
    calls = 0;
    await assert.rejects(failing(error).generateText(options), e => e === error);
    assert.equal(calls, 1);
  }
  calls = 0;
  await assert.rejects(failing(new AIRequestError('Busy', 503, 120000)).generateText(options), /sau 1 lần gọi/);
  assert.equal(calls, 1, 'Do not retry earlier than a long server cooldown');
  assert.equal(retryAfterMs('5'), 5000);
  assert.equal(retryAfterMs('invalid'), undefined);
  assert.equal(retryAfterMs(null), undefined);
  assert.equal(retryAfterMs(new Date(Date.now() - 1000).toUTCString()), 0);

  const originalFetch = global.fetch;
  try {
    for (const body of [JSON.stringify({ error: { message: overload } }), '<html>Service unavailable</html>']) {
      calls = 0;
      const delays = [];
      global.fetch = async () => ++calls === 1
        ? new Response(body, { status: 503, headers: { 'retry-after': '7' } })
        : new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: '[]' }] } }] }), { status: 200 });
      const gemini = new RetryingAIProvider(new GeminiProvider('test-key', 'test-model'), async ms => { delays.push(ms); }, () => 0);
      assert.equal(await gemini.generateText(options), '[]');
      assert.deepEqual(delays, [7000]);
      assert.equal(calls, 2);
    }
  } finally { global.fetch = originalFetch; }
  console.log('PASS: overload recovery, bounded attempts, unchanged input, permanent errors, Retry-After, JSON and HTML Gemini errors');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
