const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText, filename);
const { AntigravityCliService } = require('../src/main/services/ai/antigravity-cli.ts');
async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-adapter-test-'));
  try {
    const fake = path.join(root, 'fake-agy');
    fs.writeFileSync(fake, `#!${process.execPath}
const fs = require('node:fs');
const args = process.argv.slice(2);
let text = '';
process.stdin.on('data', data => text += data);
process.stdin.on('end', () => {
  if (text.includes('TEST_TIMEOUT')) return setTimeout(() => {}, 10000);
  if (text.includes('TEST_FAILURE')) { process.stderr.write('not logged in'); process.exit(1); }
  if (text.includes('TEST_EMPTY')) return;
  process.stdout.write(JSON.stringify({ text, args }));
});
`, { mode: 0o755 });
    const prompt = 'Truyện tiếng Việt: "Mẹ" & con. $(touch NEVER) `echo hello`\nDòng hai';
    const result = JSON.parse(await new AntigravityCliService(fake).generateText({ json: true, prompt }));
    assert.ok(result.text.endsWith(prompt));
    assert.ok(!result.args.includes(prompt));
    assert.ok(result.args.includes('--output-format'));
    assert.ok(result.args.includes('--input-format'));
    assert.ok(result.args.includes('--sandbox'));
    assert.ok(result.args.includes('--disable-slash-commands'));
    assert.ok(!result.args.includes('--print'));
    assert.ok(!result.args.includes('plan'));
    assert.ok(!result.args.includes('exec'));
    assert.ok(!result.args.includes('--skip-git-repo-check'));
    assert.ok(!result.args.includes('--ignore-user-config'), 'Respect the model saved in CLI configuration');
    assert.ok(!result.args.includes('--model'), 'Do not override the CLI model with an API model');
    await assert.rejects(new AntigravityCliService(fake).generateText({ prompt: 'TEST_FAILURE' }), /not logged in/);
    await assert.rejects(new AntigravityCliService(fake).generateText({ prompt: 'TEST_EMPTY' }), /không trả về/);
    await assert.rejects(new AntigravityCliService(fake, 100).generateText({ prompt: 'TEST_TIMEOUT' }), /quá thời gian/);
    await assert.rejects(new AntigravityCliService(path.join(root, 'missing')).generateText({ prompt: 'test' }), /Không chạy được/);
    console.log('PASS: CLI stdin transport, sandbox arguments, cleanup, failure, empty output, timeout and missing executable');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
