import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanFont, deriveTheme } from '../src/capture.js';
import { cleanTheme, validateOp } from '../src/protocol.js';
import { importStyles, sanitizeStyle } from '../src/styles.js';

const el = o => ({ tag: 'DIV', width: 300, height: 200, chars: 0, hasText: false, color: 'rgb(20,20,30)', fontSize: 16, fontFamily: 'Inter, sans-serif', fontWeight: '400', letterSpacing: 'normal', textTransform: 'none', backgroundColor: 'rgba(0,0,0,0)', backgroundImage: 'none', borderWidth: 0, borderColor: 'rgba(0,0,0,0)', radius: 0, boxShadow: 'none', ...o });

const page = [
  el({ width: 1400, height: 3000, backgroundColor: 'rgb(250,248,240)' }),
  el({ tag: 'H1', chars: 40, fontSize: 64, fontFamily: '"Fraunces", serif', fontWeight: '700', letterSpacing: '-1.5px' }),
  el({ tag: 'P', chars: 900, color: 'rgb(30,30,35)' }),
  el({ tag: 'P', chars: 300, color: 'rgb(110,110,120)' }),
  el({ tag: 'BUTTON', width: 150, height: 44, chars: 8, hasText: true, color: 'rgb(255,255,255)', backgroundColor: 'rgb(200,40,30)', radius: 22 }),
  el({ tag: 'A', chars: 20, color: 'rgb(200,40,30)', width: 80, height: 20 }),
  el({ width: 340, height: 260, backgroundColor: 'rgb(240,236,226)', radius: 12, borderWidth: 1, borderColor: 'rgb(220,214,200)', boxShadow: 'rgba(0,0,0,.1) 0 4px 12px' }),
  el({ width: 340, height: 260, backgroundColor: 'rgb(240,236,226)', radius: 12 }),
];

test('fonts come out clean, hashed names included', () => {
  assert.equal(cleanFont('__Inter_a1b2c3, __Inter_Fallback_a1b2c3'), 'Inter');
  assert.equal(cleanFont('"Space Grotesk", sans-serif'), 'Space Grotesk');
  assert.equal(cleanFont('-apple-system, sans-serif'), '');
});

test('a page reduces to a theme of its real design', () => {
  const t = deriveTheme(page, 'rgb(250,248,240)');
  assert.equal(t.bg, '#faf8f0');
  assert.equal(t.surface, '#f0ece2');
  assert.equal(t.text, '#14141e');
  assert.equal(t.muted, '#6e6e78');
  assert.equal(t.accent, '#c8281e');
  assert.equal(t.accentText, '#ffffff');
  assert.equal(t.headingFont, 'Fraunces');
  assert.equal(t.bodyFont, 'Inter');
  assert.equal(t.headingWeight, 700);
  assert.equal(t.headingSpacing, '-1.5px');
  assert.equal(t.radius, '12px');
  assert.equal(t.pill, '999px');
  assert.notEqual(t.shadow, 'none');
});

test('text is the strongest ink even when grey body copy is more common', () => {
  const t = deriveTheme([el({ width: 1400, height: 900, backgroundColor: 'rgb(255,255,255)' }), el({ chars: 2000, color: 'rgb(100,110,130)' }), el({ tag: 'H1', chars: 30, color: 'rgb(10,10,20)', fontSize: 50 })], 'rgb(255,255,255)');
  assert.equal(t.text, '#0a0a14');
  assert.equal(t.muted, '#646e82');
});

test('a stray black border does not beat the quiet one, and big radii are capped', () => {
  const t = deriveTheme([el({ width: 1400, height: 900, backgroundColor: 'rgb(255,255,255)' }), el({ borderWidth: 1, borderColor: 'rgb(0,0,0)', width: 900, height: 900 }), el({ borderWidth: 1, borderColor: 'rgb(226,229,234)', radius: 200 })], 'rgb(255,255,255)');
  assert.equal(t.border, '#e2e5ea');
  assert.equal(t.radius, '32px');
});

test('a captured theme passes the same validation as a Claude theme', () => {
  assert.ok(validateOp({ op: 'theme', ...deriveTheme(page, 'rgb(250,248,240)') }));
});

test('a page with no accent still gives a usable theme', () => {
  const t = deriveTheme([el({ width: 1000, height: 900, backgroundColor: 'rgb(0,0,0)' }), el({ chars: 100, color: 'rgb(255,255,255)' })], 'rgb(0,0,0)');
  assert.ok(cleanTheme(t));
  assert.equal(t.text, '#ffffff');
});

test('styles need a theme or a description, and imports are checked', () => {
  assert.equal(sanitizeStyle({ name: 'empty' }), null);
  assert.equal(sanitizeStyle({ name: 'x', theme: { bg: 'url(http://evil.test)' } }), null);
  assert.equal(sanitizeStyle({ name: 'words', prompt: 'Swiss poster' }).prompt, 'Swiss poster');
  const [s] = importStyles(JSON.stringify({ name: 'Mine', theme: deriveTheme(page, 'rgb(250,248,240)') }));
  assert.equal(s.name, 'Mine');
  assert.ok(s.id);
  assert.throws(() => importStyles('{"name":"bad"}'), /No valid styles/);
});
