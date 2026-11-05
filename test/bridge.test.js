import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { writeFileSync, chmodSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { FrameReader, encode, readClaudeLine } from '../bridge/frames.mjs';
import { extensionId } from '../bridge/connect.mjs';

test('frames survive being split across chunks', () => {
  const seen = [], r = new FrameReader(m => seen.push(m));
  const bytes = Buffer.concat([encode({ a: 1 }), encode({ b: 'привет' })]);
  r.feed(bytes.subarray(0, 3));
  r.feed(bytes.subarray(3, 12));
  r.feed(bytes.subarray(12));
  assert.deepEqual(seen, [{ a: 1 }, { b: 'привет' }]);
});

test('reads text, usage and errors from stream-json', () => {
  const delta = { type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'hi' } } };
  assert.deepEqual(readClaudeLine(JSON.stringify(delta)), [{ type: 'text', text: 'hi' }]);
  assert.deepEqual(readClaudeLine('{"type":"result","is_error":false,"usage":{"output_tokens":3}}'), [{ type: 'usage', usage: { output_tokens: 3 } }]);
  assert.deepEqual(readClaudeLine('{"type":"result","is_error":true,"result":"Not logged in"}'), [{ type: 'error', message: 'Not logged in' }]);
  assert.deepEqual(readClaudeLine('{"type":"system"}'), []);
  assert.deepEqual(readClaudeLine('not json'), []);
});

test('extension ID follows the Chrome algorithm', () => {
  const key = JSON.parse(readFileSync('extension/manifest.json', 'utf8')).key;
  assert.match(extensionId(key), /^[a-p]{32}$/);
});

test('every run has tools, MCP and settings off, and ignores unknown arguments', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'fake-claude-'));
  const fake = path.join(dir, 'claude');
  const log = path.join(dir, 'args.json');
  writeFileSync(fake, `#!/usr/bin/env node
require('fs').writeFileSync(${JSON.stringify(log)}, JSON.stringify({ args: process.argv.slice(2), cwd: process.cwd() }));
process.stdin.resume();
process.stdin.on('end', () => {
  console.log(JSON.stringify({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'ok' } } }));
  console.log(JSON.stringify({ type: 'result', is_error: false, usage: { output_tokens: 1 } }));
});
`);
  chmodSync(fake, 0o755);
  const host = spawn(process.execPath, ['bridge/host.mjs'], { env: { ...process.env, REDRAFT_CLAUDE: fake } });
  const seen = [];
  const reader = new FrameReader(m => seen.push(m));
  host.stdout.on('data', d => reader.feed(d));
  host.stdin.write(encode({ type: 'run', id: 1, system: 'sys', user: 'hello', effort: 'high', model: 'x; rm -rf /' }));
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), 5000);
    const i = setInterval(() => { if (seen.some(m => m.type === 'end')) { clearInterval(i); clearTimeout(t); resolve(); } }, 20);
  });
  host.stdin.end();
  assert.deepEqual(seen.map(m => m.type), ['text', 'usage', 'end']);
  const { args, cwd } = JSON.parse(readFileSync(log, 'utf8'));
  assert.equal(args[args.indexOf('--tools') + 1], '');
  assert.equal(args[args.indexOf('--setting-sources') + 1], '');
  assert.ok(args.includes('--strict-mcp-config'));
  assert.ok(!args.includes('--model'), 'a bad model string is dropped');
  assert.ok(cwd.includes('redraft-'), 'runs in an empty temp folder');
});
