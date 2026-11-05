import test from 'node:test';
import assert from 'node:assert/strict';
import { LineParser, cleanCss, fontImport, ruleToCss, scrub, validateOp } from '../src/protocol.js';

test('css: keeps normal declarations and strips !important', () => {
  assert.deepEqual(cleanCss({ color: 'red !important', '--nx-bg': '#000', 'font-size': 16 }), { color: 'red', '--nx-bg': '#000', 'font-size': '16' });
});

test('css: blocks anything that could load a resource or run code', () => {
  for (const value of ['url(https://evil.test/x)', 'URL ("a")', 'image-set("a.png" 1x)', 'expression(alert(1))', 'javascript:alert(1)', '<script>', '\\75rl(x)']) {
    assert.equal(cleanCss({ background: value }), null, value);
  }
  assert.equal(cleanCss({ behavior: 'x', '-moz-binding': 'x' }), null);
  assert.equal(cleanCss('color:red'), null);
});

test('ops: rejects malformed and unknown ops', () => {
  assert.equal(validateOp({ op: 'style', id: '1', css: { color: 'red' } }), null);
  assert.equal(validateOp({ op: 'style', id: 1, css: { background: 'url(x)' } }), null);
  assert.equal(validateOp({ op: 'html', id: 1, html: '<img onerror=x>' }), null);
  assert.equal(validateOp({ op: 'rule', selector: 'a{}b', css: { color: 'red' } }), null);
  assert.equal(validateOp({ op: 'rule', selector: '@import x', css: { color: 'red' } }), null);
  assert.equal(validateOp({ op: 'font', family: 'x"); }' }), null);
  assert.equal(validateOp(null), null);
});

test('ops: text changes need the explicit opt-in', () => {
  const op = { op: 'text', id: 4, text: 'Hello' };
  assert.equal(validateOp(op), null);
  assert.deepEqual(validateOp(op, { allowText: true }), op);
});

test('rules serialize with !important and media', () => {
  assert.equal(ruleToCss({ selector: 'a', css: { color: 'red' } }), 'a{color:red !important}');
  assert.equal(ruleToCss({ selector: 'a', css: { color: 'red' }, media: '(max-width: 600px)' }), '@media (max-width: 600px){a{color:red !important}}');
});

test('font import only ever points at Google Fonts', () => {
  assert.match(fontImport('Space Grotesk'), /fonts\.googleapis\.com\/css2\?family=Space\+Grotesk:/);
});

test('parser handles split chunks, fences and junk', () => {
  const seen = [], p = new LineParser(v => seen.push(v));
  p.feed('```json\n{"op":"a"');
  p.feed('}\nnot json\n{"op":"b"}\n```\n{"op":"c"}');
  p.end();
  assert.deepEqual(seen.map(v => v.op), ['a', 'b', 'c']);
  assert.equal(p.bad, 1);
});

test('scrub masks emails, card-like numbers and tokens', () => {
  const s = scrub('Mail me@site.co card 4242 4242 4242 4242 key sk_live_ABCDEFGHIJKLMNOPQRSTUVWXYZ123456 in 2026');
  assert.equal(s, 'Mail [email] card [number] key [token] in 2026');
});
