// npm run connect: registers the bridge with your browsers. Run once per computer.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const HOST = 'com.redraft.bridge';
const here = path.dirname(fileURLToPath(import.meta.url));

// Chrome derives an extension ID from its public key: the first 16 bytes of the SHA-256,
// written as hex with the digits 0-f shifted to the letters a-p.
export function extensionId(key) {
  const hash = createHash('sha256').update(Buffer.from(key, 'base64')).digest('hex').slice(0, 32);
  return [...hash].map(c => String.fromCharCode(97 + parseInt(c, 16))).join('');
}

function browserDirs() {
  const home = homedir();
  if (platform() === 'darwin') {
    const base = path.join(home, 'Library/Application Support');
    return ['Google/Chrome', 'Google/Chrome Canary', 'Chromium', 'BraveSoftware/Brave-Browser', 'Microsoft Edge', 'Arc/User Data'].map(d => path.join(base, d));
  }
  const base = path.join(home, '.config');
  return ['google-chrome', 'chromium', 'BraveSoftware/Brave-Browser', 'microsoft-edge'].map(d => path.join(base, d));
}

function findClaude() {
  if (process.env.REDRAFT_CLAUDE) return process.env.REDRAFT_CLAUDE;
  // nvm and similar only set PATH in interactive shells, so try those too.
  const shell = process.env.SHELL || '/bin/sh';
  for (const flag of ['-c', '-lc', '-lic']) {
    try {
      const found = execFileSync(shell, [flag, 'command -v claude'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim().split('\n').pop();
      if (found.startsWith('/')) return found;
    } catch {}
  }
  return '';
}

export function connect({ dirs = browserDirs() } = {}) {
  if (platform() === 'win32') throw new Error('Windows is not supported yet. Use an API key in Options there.');
  const claude = findClaude();
  if (!claude) throw new Error('Claude Code was not found. Install it first: https://claude.com/claude-code');
  const version = execFileSync(claude, ['--version'], { encoding: 'utf8' }).trim();

  // Chrome starts hosts with a bare environment, so the launcher pins exact paths.
  const launcher = path.join(here, 'host.sh');
  const bin = [path.dirname(process.execPath), path.dirname(claude), '/usr/local/bin', '/opt/homebrew/bin', '/usr/bin', '/bin'].join(':');
  writeFileSync(launcher, `#!/bin/sh\nexport PATH=${JSON.stringify(bin)}\nexport REDRAFT_CLAUDE=${JSON.stringify(claude)}\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(path.join(here, 'host.mjs'))}\n`);
  chmodSync(launcher, 0o755);

  const { key } = JSON.parse(readFileSync(path.join(here, '../extension/manifest.json'), 'utf8'));
  const id = extensionId(key);
  const manifest = {
    name: HOST, description: 'Redraft bridge to Claude Code', path: launcher, type: 'stdio',
    allowed_origins: [`chrome-extension://${id}/`],
  };
  const done = [];
  for (const dir of dirs) {
    if (!existsSync(dir)) continue;
    const target = path.join(dir, 'NativeMessagingHosts');
    mkdirSync(target, { recursive: true });
    writeFileSync(path.join(target, `${HOST}.json`), JSON.stringify(manifest, null, 2));
    rmSync(path.join(target, 'com.codez.swarm.json'), { force: true }); // the old name
    done.push(dir);
  }
  return { id, claude, version, done };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { id, version, done } = connect();
  if (!done.length) throw new Error('No Chromium-based browser profile found.');
  console.log(`Connected ${version}`);
  console.log(`Extension ID ${id}`);
  done.forEach(d => console.log(`Registered in ${d}`));
}
