import { build } from 'vite';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { spawn } from 'node:child_process';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

async function run() {
  console.log('Bundling test script with Vite...');
  await build({
    root,
    build: {
      ssr: join(root, 'tools', 'generate-test-images.ts'),
      outDir: join(root, 'out', 'test-runner'),
      emptyOutDir: true,
      rollupOptions: {
        external: ['sharp', 'node:fs/promises', 'node:path', 'node:os', 'node:fs', 'node:child_process', 'node:crypto']
      }
    }
  });

  console.log('Running bundled test script...');
  const proc = spawn('node', [join(root, 'out', 'test-runner', 'generate-test-images.mjs')], {
    cwd: root,
    stdio: 'inherit'
  });

  proc.on('exit', code => {
    process.exit(code ?? 0);
  });
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
