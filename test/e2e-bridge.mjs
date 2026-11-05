// The Claude Code route in a real browser: real service worker, real native messaging, real
// bridge. FAKE=1 swaps in a scripted claude; without it this runs your real Claude Code and
// uses your plan's usage on test/fixture.html.
import http from 'node:http';
import path from 'node:path';
import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';
import { connect } from '../bridge/connect.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const shots = process.env.SHOTS || path.join(here, 'shots');
mkdirSync(shots, { recursive: true });
execSync('node build.mjs', { cwd: path.join(here, '..'), env: { ...process.env, E2E: '1' }, stdio: 'inherit' });

const profile = mkdtempSync(path.join(tmpdir(), 'redraft-e2e-'));
if (process.env.FAKE) {
  const fake = path.join(profile, 'fake-claude');
  writeFileSync(fake, `#!/usr/bin/env node
if (process.argv.includes('--version')) { console.log('9.9.9 (fake)'); process.exit(0); }
const system = process.argv[process.argv.indexOf('--system-prompt') + 1];
let input = '';
process.stdin.on('data', d => input += d);
process.stdin.on('end', async () => {
  const ops = system.includes('art director')
    ? [{ op: 'brief', name: 'Bridge test', summary: 'Dark.' }, { op: 'theme', bg: '#14110f', surface: '#221d19', text: '#f5efe6', muted: '#b8ad9e', accent: '#e08a3c', accentText: '#14110f', border: '#3a322b', radius: '6px', shadow: 'none' }]
    : [...input.matchAll(/^\\s*(\\d+) /gm)].slice(0, 30).map(m => ({ op: 'style', id: +m[1], css: { 'border-radius': '6px' } }));
  for (const op of ops) {
    console.log(JSON.stringify({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: JSON.stringify(op) + '\\n' } } }));
    await new Promise(r => setTimeout(r, 15));
  }
  console.log(JSON.stringify({ type: 'result', is_error: false, usage: { input_tokens: 500, output_tokens: 200 } }));
});
`);
  chmodSync(fake, 0o755);
  process.env.REDRAFT_CLAUDE = fake;
}
const linked = connect({ dirs: [profile] });
console.log('bridge', linked.id, linked.version);

const server = http.createServer(async (req, res) => {
  const file = req.url.split('?')[0] === '/' ? 'fixture.html' : path.basename(req.url.split('?')[0]);
  try {
    const data = readFileSync(path.join(here, file));
    res.writeHead(200, { 'content-type': file.endsWith('.css') ? 'text/css' : 'text/html', 'content-security-policy': "default-src 'self'; style-src 'self'; font-src 'self'" });
    res.end(data);
  } catch { res.writeHead(404); res.end(); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;

const browser = await puppeteer.launch({
  executablePath: process.env.CHROME, headless: 'new', pipe: true, userDataDir: profile,
  enableExtensions: [path.resolve(here, '../dist-e2e')], defaultViewport: { width: 1280, height: 800 },
  args: ['--no-first-run'],
});
const found = await browser.waitForTarget(t => t.type() === 'service_worker', { timeout: 15000 });
const worker = await found.worker();
assert.ok(found.url().includes(linked.id), `extension loaded as ${found.url()}`);
await worker.evaluate(() => chrome.storage.local.set({ connection: 'claude-code', effort: 'low', concurrency: 3 }));

const page = await browser.newPage();
const errors = [];
page.on('pageerror', e => errors.push(e.message));
page.on('console', m => { if (m.type() === 'warn' || m.type() === 'warning') console.log('page:', m.text()); });
await page.goto(base);
await page.screenshot({ path: `${shots}/bridge-0.png` });
await worker.evaluate(async url => {
  const [tab] = await chrome.tabs.query({ url: `${url}/*` });
  await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
  await chrome.tabs.sendMessage(tab.id, { type: 'run', settings: { style: 'A confident print-magazine feel: strong serif headlines, warm paper tones, one ink accent.', preset: 'editorial', allowText: false, agents: 200 } });
}, base);
const t0 = Date.now();
await new Promise(r => setTimeout(r, 2500));
await page.screenshot({ path: `${shots}/bridge-1.png` });
const hud = id => page.evaluate(i => document.getElementById('redraft').shadowRoot.getElementById(i).textContent, id);
await page.waitForFunction(() => +document.getElementById('redraft').shadowRoot.getElementById('ops').textContent > 6, { timeout: 200000, polling: 500 });
await page.screenshot({ path: `${shots}/bridge-2.png` });
await page.waitForFunction(() => !document.getElementById('redraft').shadowRoot.getElementById('close').hidden, { timeout: 280000, polling: 500 });
await new Promise(r => setTimeout(r, 1200));
await page.screenshot({ path: `${shots}/bridge-3.png`, fullPage: true });
console.log('status:', await hud('status'), '| edits:', await hud('ops'), '| tokens:', await hud('tokens'), '| took', Math.round((Date.now() - t0) / 1000), 's');
console.log('errors', errors);
assert.deepEqual(errors, []);
assert.notEqual(await hud('ops'), '0');
await browser.close();
server.close();
console.log('bridge e2e ok');
