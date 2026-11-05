// Drives the real extension in Chromium: real service worker, real Anthropic SDK, real SSE
// parsing, against a local mock of POST /v1/messages. Costs nothing and needs no API key.
// CHROME=/path/to/Chromium npm run e2e    (Chrome stable no longer allows --load-extension)
import http from 'node:http';
import path from 'node:path';
import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const here = path.dirname(fileURLToPath(import.meta.url));
const shots = process.env.SHOTS || path.join(here, 'shots');
await mkdir(shots, { recursive: true });
execSync('node build.mjs', { cwd: path.join(here, '..'), env: { ...process.env, E2E: '1' }, stdio: 'inherit' });

const sse = (type, data) => `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`;
const requests = [];

function reply(body) {
  const director = body.system[0].text.includes('art director');
  if (director) {
    return [
      { op: 'brief', name: 'Test paper', summary: 'Dark ground, warm accent.' },
      { op: 'font', family: 'Fraunces' },
      { op: 'rule', selector: ':root', css: { '--nx-bg': '#14110f' } },
      { op: 'rule', selector: 'body', css: { background: '#14110f', color: '#f5efe6' } },
      { op: 'rule', selector: 'a', css: { background: 'url(http://evil.test/x)' } },
    ];
  }
  const ids = [...body.messages[0].content.matchAll(/^\s*(\d+) /gm)].map(m => +m[1]);
  return ids.slice(0, 40).map(id => ({ op: 'style', id, css: { 'border-radius': '6px', color: '#f5efe6', background: '#221d19' } }));
}

const server = http.createServer(async (req, res) => {
  const url = req.url.split('?')[0];
  if (url === '/v1/messages') {
    let raw = '';
    for await (const c of req) raw += c;
    const body = JSON.parse(raw);
    requests.push({ body, headers: req.headers });
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.write(sse('message_start', { message: { id: 'msg_1', type: 'message', role: 'assistant', model: body.model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 1200, output_tokens: 1 } } }));
    res.write(sse('content_block_start', { index: 0, content_block: { type: 'text', text: '' } }));
    const text = reply(body).map(o => JSON.stringify(o)).join('\n');
    for (let i = 0; i < text.length; i += 60) {
      res.write(sse('content_block_delta', { index: 0, delta: { type: 'text_delta', text: text.slice(i, i + 60) } }));
      await new Promise(r => setTimeout(r, 12));
    }
    res.write(sse('content_block_stop', { index: 0 }));
    res.write(sse('message_delta', { delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 800 } }));
    res.end(sse('message_stop', {}));
    return;
  }
  const file = url === '/' ? 'fixture.html' : url.slice(1);
  try {
    const data = await readFile(path.join(here, path.basename(file)));
    // A strict CSP proves restyling does not depend on inline <style> being allowed.
    res.writeHead(200, { 'content-type': file.endsWith('.css') ? 'text/css' : 'text/html', 'content-security-policy': "default-src 'self'; style-src 'self'; font-src 'self'" });
    res.end(data);
  } catch { res.writeHead(404); res.end(); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;

const dist = path.resolve(here, '../dist-e2e');
const browser = await puppeteer.launch({
  executablePath: process.env.CHROME, headless: process.env.HEADFUL ? false : 'new', pipe: true, enableExtensions: [dist],
  defaultViewport: { width: 1280, height: 800 },
  args: ['--no-first-run', '--enable-gpu-rasterization'],
});

const found = await browser.waitForTarget(t => t.type() === 'service_worker', { timeout: 15000 });
const worker = await found.worker();
await worker.evaluate(url => chrome.storage.local.set({ apiKey: 'sk-ant-test', apiBaseUrl: url, concurrency: 3 }), base);

const page = await browser.newPage();
const errors = [];
page.on('pageerror', e => errors.push(e.message));
await page.goto(base);

const launch = settings => worker.evaluate(async (s, url) => {
  const [tab] = await chrome.tabs.query({ url: `${url}/*` });
  await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
  await chrome.tabs.sendMessage(tab.id, { type: 'run', settings: s });
}, settings, base);
const hud = id => page.evaluate(i => document.getElementById('codez-swarm').shadowRoot.getElementById(i).textContent, id);
const hudHidden = id => page.evaluate(i => document.getElementById('codez-swarm').shadowRoot.getElementById(i).hidden, id);
const finished = () => page.waitForFunction(() => {
  const r = document.getElementById('codez-swarm')?.shadowRoot;
  return r && !r.getElementById('undo').hidden;
}, { timeout: 90000 });

await launch({ style: 'dark bakery', preset: 'editorial', allowText: false, agents: 200 });
await new Promise(r => setTimeout(r, 900));
await page.screenshot({ path: `${shots}/1-blueprint.png` });
await page.waitForFunction(() => +document.getElementById('codez-swarm').shadowRoot.getElementById('ops').textContent > 14, { timeout: 30000 });
await page.screenshot({ path: `${shots}/2-building.png` });
await finished();
await new Promise(r => setTimeout(r, 1000));
await page.screenshot({ path: `${shots}/3-done.png` });

// The request Claude would actually receive.
const prompts = requests.map(r => r.body.messages[0].content).join('\n');
assert.ok(requests.length >= 3, 'director and section agents all called');
assert.equal(requests[0].body.model, 'claude-opus-5-5');
assert.deepEqual(requests[0].body.thinking, { type: 'adaptive' });
assert.equal(requests[0].body.fallbacks, 'default');
assert.ok(String(requests[0].headers['anthropic-beta']).includes('server-side-fallback-2026-07-01'));
assert.equal(requests[0].headers['anthropic-dangerous-direct-browser-access'], 'true');
assert.equal(requests[0].headers['x-api-key'] ?? requests[0].headers.authorization?.replace('Bearer ', ''), 'sk-ant-test', JSON.stringify(Object.keys(requests[0].headers)));
assert.ok(!prompts.includes('hunter2') && !prompts.includes('SECRET-VALUE'), 'form values never leave the page');
assert.ok(!prompts.includes('baker@plain.test') && !prompts.includes('4242 4242'), 'emails and numbers are masked');
assert.ok(prompts.includes('Fresh bread'), 'visible text is present');

// The page really changed, through a CSP that blocks inline <style>.
const look = await page.evaluate(() => {
  const s = getComputedStyle(document.body), a = getComputedStyle(document.querySelector('a'));
  return { bg: s.backgroundColor, h1: document.querySelector('h1').getAttribute('style'), link: a.backgroundImage };
});
assert.equal(look.bg, 'rgb(20, 17, 15)');
assert.match(look.h1 || '', /border-radius/);
assert.equal(look.link, 'none', 'url() rule was rejected');
assert.match(await hud('status'), /Done in/);

// Undo puts everything back.
await page.evaluate(() => document.getElementById('codez-swarm').shadowRoot.getElementById('undo').click());
await page.waitForFunction(() => getComputedStyle(document.body).backgroundColor === 'rgb(255, 255, 255)', { timeout: 5000 });
assert.equal(await page.evaluate(() => document.querySelector('h1').getAttribute('style')), null);

// Demo mode needs no key.
await worker.evaluate(() => chrome.storage.local.remove('apiKey'));
await launch({ style: '', preset: 'terminal', allowText: false, demo: true, agents: 120 });
await finished();
assert.equal(await page.evaluate(() => getComputedStyle(document.body).backgroundColor), 'rgb(10, 15, 11)');

assert.deepEqual(errors, []);
console.log('e2e ok:', requests.length, 'API calls');
await browser.close();
server.close();
