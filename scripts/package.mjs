// npm run package: builds the file the website offers for download. It holds the ready
// extension and the Claude Code bridge, so people need neither GitHub nor a build step.
import { execSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
execSync('node build.mjs', { cwd: root, stdio: 'inherit' });

const { version } = JSON.parse(await readFile(path.join(root, 'extension/manifest.json'), 'utf8'));
const stage = await mkdtemp(path.join(tmpdir(), 'redraft-'));
const out = path.join(stage, 'Redraft');
await mkdir(path.join(out, 'bridge'), { recursive: true });
await cp(path.join(root, 'dist'), path.join(out, 'extension'), { recursive: true });
for (const file of ['connect.mjs', 'frames.mjs', 'host.mjs']) await cp(path.join(root, 'bridge', file), path.join(out, 'bridge', file));
await writeFile(path.join(out, 'README.txt'), `Redraft ${version}

1. Keep this folder somewhere permanent. Chrome loads the extension from it.
2. Open chrome://extensions, turn on Developer mode, click Load unpacked and
   choose the "extension" folder.
3. With Claude Code installed and logged in, run this once in Terminal, using
   the real path of this folder:

     node ~/Downloads/Redraft/bridge/connect.mjs

   Run it again if you move the folder. macOS and Linux only for now.
   Without Claude Code, or on Windows, paste an Anthropic API key in Redraft settings.
`);
const target = path.join(root, 'landing/redraft.zip');
await rm(target, { force: true });
execSync(`zip -qr ${JSON.stringify(target)} Redraft -x "*.DS_Store"`, { cwd: stage });
await rm(stage, { recursive: true });
console.log(`landing/redraft.zip (${version})`);
