// Runs on your computer, started by Chrome through native messaging. Only the extension ID
// listed in the host manifest can reach it, so no port is open to websites. It turns one
// agent request into one `claude -p` run and streams the text back.
//
// Page text reaches the model, so a poisoned page could try to steer it. Every run has all
// tools off, no MCP servers, no settings or hooks, and an empty working directory: the model
// can only return text, and the extension validates that text before it touches a page.
import { spawn, execFile } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { FrameReader, encode, readClaudeLine } from './frames.mjs';

const CLAUDE = process.env.REDRAFT_CLAUDE || 'claude';
const EFFORTS = new Set(['low', 'medium', 'high']);
const MODEL = /^[a-z0-9.\[\]-]{1,60}$/i;
const running = new Map();
const send = message => process.stdout.write(encode(message));

function run({ id, system, user, effort, model }) {
  const cwd = mkdtempSync(path.join(tmpdir(), 'redraft-'));
  const args = [
    '-p', '--output-format', 'stream-json', '--verbose', '--include-partial-messages',
    '--tools', '', '--strict-mcp-config', '--setting-sources', '', '--no-session-persistence',
    '--system-prompt', String(system),
  ];
  if (EFFORTS.has(effort)) args.push('--effort', effort);
  if (MODEL.test(model || '')) args.push('--model', model);

  const child = spawn(CLAUDE, args, { cwd, stdio: ['pipe', 'pipe', 'pipe'] });
  running.set(id, child);
  let stderr = '', failed = false;
  child.stderr.on('data', d => { stderr = (stderr + d).slice(-600); });
  child.on('error', err => {
    failed = true;
    send({ id, type: 'error', message: err.code === 'ENOENT' ? 'Claude Code was not found. Install it, then run npm run connect.' : err.message });
  });
  createInterface({ input: child.stdout }).on('line', line => {
    for (const event of readClaudeLine(line)) {
      if (event.type === 'error') failed = true;
      send({ id, ...event });
    }
  });
  child.on('close', code => {
    running.delete(id);
    rmSync(cwd, { recursive: true, force: true });
    if (code && !failed) send({ id, type: 'error', message: stderr.trim() || `Claude Code exited with code ${code}.` });
    send({ id, type: 'end' });
  });
  child.stdin.on('error', () => {});
  child.stdin.end(String(user));
}

const reader = new FrameReader(message => {
  if (message.type === 'ping') {
    execFile(CLAUDE, ['--version'], (err, stdout) => send({ id: message.id, type: 'pong', ok: !err, version: String(stdout || '').trim() }));
  } else if (message.type === 'run') {
    run(message);
  } else if (message.type === 'cancel') {
    running.get(message.id)?.kill();
  }
});
process.stdin.on('data', chunk => reader.feed(chunk));
process.stdin.on('end', () => {
  for (const child of running.values()) child.kill();
  process.exit(0);
});
