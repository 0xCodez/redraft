import test from 'node:test';
import assert from 'node:assert/strict';
import { parseColor, restyle, saturation } from '../src/theme.js';
import { cleanTheme, validateOp } from '../src/protocol.js';

const theme = cleanTheme({ bg: '#fff', surface: '#eee', text: '#000', muted: '#555', accent: '#fe0', accentText: '#000', border: '#000', headingFont: 'Archivo Black', bodyFont: 'Inter', radius: '0px', pill: '4px', shadow: '4px 4px 0 #000' });
const view = { width: 1440, height: 900 };
const base = { tag: 'DIV', width: 600, height: 200, hasText: false, backgroundColor: 'rgba(0, 0, 0, 0)', backgroundImage: 'none', backgroundClip: 'border-box', color: 'rgb(20, 20, 20)', borderWidth: 0, borderColor: 'rgba(0, 0, 0, 0)', radius: 0, boxShadow: 'none', fontSize: 16, fontFamily: 'Inter', parentBg: { r: 255, g: 255, b: 255, a: 1 } };

test('colours parse', () => {
  assert.deepEqual(parseColor('rgba(10, 20, 30, 0.5)'), { r: 10, g: 20, b: 30, a: .5 });
  assert.equal(parseColor('transparent').a, 0);
  assert.ok(saturation({ r: 255, g: 0, b: 0 }) > .9);
});

test('a plain wrapper gets no edits', () => {
  assert.deepEqual(restyle(base, 'bg', theme, view).css, {});
});

test('a saturated button becomes the accent and its text follows', () => {
  const r = restyle({ ...base, tag: 'BUTTON', width: 140, height: 44, backgroundColor: 'rgb(90, 40, 250)', hasText: true, color: 'rgb(255,255,255)' }, 'bg', theme, view);
  assert.equal(r.css.background, theme.accent);
  assert.equal(r.css.color, theme.accentText);
  assert.equal(r.ground, 'accent');
});

test('a gradient panel becomes a flat surface, a wide band the page ground', () => {
  assert.equal(restyle({ ...base, backgroundImage: 'linear-gradient(red, blue)' }, 'bg', theme, view).css.background, theme.surface);
  assert.equal(restyle({ ...base, width: 1440, height: 700, backgroundColor: 'rgb(240,240,255)' }, 'bg', theme, view).css.background, theme.bg);
});

test('gradient text loses the clip and takes the accent', () => {
  const { css } = restyle({ ...base, tag: 'SPAN', hasText: true, backgroundImage: 'linear-gradient(red, blue)', backgroundClip: 'text' }, 'bg', theme, view);
  assert.equal(css['-webkit-text-fill-color'], theme.accent);
  assert.equal(css.background, 'none');
});

test('background images are left alone', () => {
  assert.equal(restyle({ ...base, backgroundImage: 'url("a.jpg")', backgroundColor: 'rgb(0,0,0)' }, 'bg', theme, view).css.background, undefined);
});

test('headings, radii, borders and shadows follow the theme', () => {
  const { css } = restyle({ ...base, tag: 'H2', hasText: true, radius: 16, borderWidth: 3, borderColor: 'rgb(1,1,1)', boxShadow: 'rgb(0,0,0) 0 1px 2px' }, 'bg', theme, view);
  assert.match(css['font-family'], /Archivo Black/);
  assert.equal(css['border-radius'], '0px');
  assert.equal(css['border-color'], '#000');
  assert.equal(css['box-shadow'], theme.shadow);
});

test('blurred decoration is removed instead of recoloured', () => {
  assert.equal(restyle({ ...base, decor: true }, 'bg', theme, view).css.display, 'none');
});

test('theme ops reject url() and require every colour', () => {
  assert.equal(validateOp({ op: 'theme', bg: 'url(http://x)', surface: '#1', text: '#1', muted: '#1', accent: '#1', accentText: '#1', border: '#1' }), null);
  assert.equal(validateOp({ op: 'theme', bg: '#000' }), null);
});
