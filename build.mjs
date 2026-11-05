// Bundles into dist/, the folder you load in chrome://extensions.
// E2E=1 builds dist-e2e/, which may also reach localhost for the mock API test.
import { build } from 'esbuild';
import { cp, rm, readFile, writeFile } from 'node:fs/promises';

const e2e = !!process.env.E2E;
const out = e2e ? 'dist-e2e' : 'dist';

await rm(out, { recursive: true, force: true });
await cp('extension', out, { recursive: true });
await build({
  entryPoints: ['src/background.js', 'src/popup.js', 'src/options.js'],
  bundle: true, format: 'esm', target: 'chrome120', outdir: out, logLevel: 'warning',
});
await build({
  entryPoints: ['src/content.js'],
  bundle: true, format: 'iife', target: 'chrome120', outdir: out, logLevel: 'warning',
});
if (e2e) {
  const file = `${out}/manifest.json`, manifest = JSON.parse(await readFile(file, 'utf8'));
  manifest.host_permissions.push('<all_urls>');
  await writeFile(file, JSON.stringify(manifest, null, 2));
}
console.log(`built ${out}/`);
