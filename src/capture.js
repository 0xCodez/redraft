// "Copy this page's style": reads the design a site actually uses and turns it into a theme
// that can be applied anywhere. It runs locally and sends nothing to Claude.
import { lightness, parseColor, saturation } from './theme.js';

const hex = ({ r, g, b }) => `#${[r, g, b].map(n => Math.round(n).toString(16).padStart(2, '0')).join('')}`;
const mix = (a, b, t) => ({ r: a.r + (b.r - a.r) * t, g: a.g + (b.g - a.g) * t, b: a.b + (b.b - a.b) * t, a: 1 });
const unhex = s => ({ r: parseInt(s.slice(1, 3), 16), g: parseInt(s.slice(3, 5), 16), b: parseInt(s.slice(5, 7), 16), a: 1 });

class Tally {
  constructor() { this.map = new Map(); }
  add(key, weight = 1) { if (key) this.map.set(key, (this.map.get(key) || 0) + weight); }
  ranked() { return [...this.map.entries()].sort((a, b) => b[1] - a[1]).map(e => e[0]); }
  top() { return this.ranked()[0]; }
}

// Next.js and friends hash font names: "__Inter_a1b2c3" means Inter.
export function cleanFont(family) {
  const first = String(family || '').split(',')[0].replace(/["']/g, '').trim();
  const name = first.replace(/^_+/, '').replace(/_(Fallback_)?[0-9a-f]{5,}$/i, '').replace(/_/g, ' ').trim();
  return /^[A-Za-z0-9 ]{2,40}$/.test(name) && !/^(system ui|sans serif|serif|monospace|ui sans serif|BlinkMacSystemFont)$/i.test(name.replace(/-/g, ' ')) ? name : '';
}

const distance = (a, b) => Math.abs(a.r - b.r) + Math.abs(a.g - b.g) + Math.abs(a.b - b.b);
const chroma = ({ r, g, b }) => Math.max(r, g, b) - Math.min(r, g, b);
const contrastInk = c => (lightness(c) > .55 ? '#0a0a0a' : '#ffffff');

// `samples` is a list of plain records, so the logic can be tested without a browser.
export function deriveTheme(samples, pageBg) {
  const grounds = new Tally(), inks = new Tally(), accents = new Tally(), borders = new Tally();
  const headFont = new Tally(), bodyFont = new Tally(), monoFont = new Tally(), shadows = new Tally();
  const weights = new Tally(), tracks = new Tally(), cases = new Tally(), widths = new Tally();
  const radii = [], pills = [];
  let accentInk = null;

  for (const s of samples) {
    const bg = parseColor(s.backgroundColor), area = s.width * s.height;
    const gradient = String(s.backgroundImage).match(/rgba?\([^)]+\)/);
    const compact = s.height < 90 && s.width < 460 && s.width > 24;
    const fill = bg.a > .5 ? bg : gradient ? parseColor(gradient[0]) : null;
    if (bg.a > .5) grounds.add(hex(bg), area);
    if (fill && compact && saturation(fill) > .35) {
      accents.add(hex(fill), 40);
      if (!accentInk && s.hasText) accentInk = hex(parseColor(s.color));
    }
    if (s.chars) {
      const ink = parseColor(s.color);
      inks.add(hex(ink), s.chars);
      if (saturation(ink) > .45) accents.add(hex(ink), s.tag === 'A' ? 6 : 1);
      const font = cleanFont(s.fontFamily);
      if (/mono|courier|consolas|menlo/i.test(s.fontFamily)) monoFont.add(font, s.chars);
      else if (/^H[1-3]$/.test(s.tag) || s.fontSize >= 28) {
        headFont.add(font, s.chars * 4);
        weights.add(s.fontWeight, s.chars);
        tracks.add(s.letterSpacing === 'normal' ? '' : s.letterSpacing, s.chars);
        cases.add(s.textTransform, s.chars);
      } else bodyFont.add(font, s.chars);
    }
    if (s.borderWidth > 0) {
      const b = parseColor(s.borderColor);
      if (b.a > .05) { borders.add(hex(b), area ? Math.sqrt(area) : 1); widths.add(`${Math.round(s.borderWidth)}px`, 1); }
    }
    if (s.radius > 0) {
      if (compact && s.radius >= s.height / 2) pills.push(s.radius);
      else if (s.width > 80 && s.height > 60) radii.push(Math.min(s.radius, 32));
    }
    if (s.boxShadow && s.boxShadow !== 'none' && area > 4000) shadows.add(s.boxShadow, 1);
  }

  const bgHex = pageBg && parseColor(pageBg).a > .5 ? hex(parseColor(pageBg)) : grounds.top() || '#ffffff';
  const bgColor = unhex(bgHex);
  const surfaceHex = grounds.ranked().find(c => c !== bgHex && distance(unhex(c), bgColor) > 6 && distance(unhex(c), bgColor) < 240 && saturation(unhex(c)) < .5);
  const surface = surfaceHex ? unhex(surfaceHex) : mix(bgColor, lightness(bgColor) > .5 ? { r: 0, g: 0, b: 0 } : { r: 255, g: 255, b: 255 }, .05);

  // Main text is the strongest of the common inks; the next one down is the muted tone.
  const gap = c => Math.abs(lightness(unhex(c)) - lightness(bgColor));
  const readable = inks.ranked().filter(c => gap(c) > .3 && chroma(unhex(c)) < 70).slice(0, 4).sort((a, b) => gap(b) - gap(a));
  const textHex = readable[0] || contrastInk(bgColor);
  const text = unhex(textHex);
  const mutedHex = readable.find(c => distance(unhex(c), text) > 90) || hex(mix(text, bgColor, .4));
  const accentHex = accents.ranked().find(c => distance(unhex(c), bgColor) > 60) || textHex;
  const accent = unhex(accentHex);
  const onAccent = accentInk && distance(unhex(accentInk), accent) > 120 ? accentInk : contrastInk(accent);

  const median = list => { const s = [...list].sort((a, b) => a - b); return s.length ? s[s.length >> 1] : 0; };
  const heavyBorder = parseInt(widths.top(), 10) >= 2;
  // Borders are usually a quiet tint of the page. Black or white here tends to be a browser
  // default on a zero-looking edge, unless the site really draws heavy lines.
  const quiet = borders.ranked().slice(0, 4).filter(c => distance(unhex(c), bgColor) > 10);
  const borderHex = (heavyBorder ? quiet[0] : quiet.sort((a, b) => distance(unhex(a), bgColor) - distance(unhex(b), bgColor))[0]) || hex(mix(bgColor, text, .16));

  return {
    bg: bgHex, surface: hex(surface), text: textHex, muted: mutedHex, accent: accentHex, accentText: onAccent,
    border: borderHex, ...(heavyBorder ? { borderWidth: widths.top() } : {}),
    headingFont: headFont.top() || bodyFont.top() || '', bodyFont: bodyFont.top() || headFont.top() || '', monoFont: monoFont.top() || '',
    headingWeight: Math.round((+weights.top() || 700) / 100) * 100, headingSpacing: tracks.top() || 'normal',
    headingCase: cases.top() === 'uppercase' ? 'uppercase' : 'none',
    radius: `${median(radii)}px`, pill: pills.length ? '999px' : `${median(radii)}px`, shadow: shadows.top() || 'none',
  };
}

const SKIP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'SVG', 'PATH', 'IMG', 'VIDEO', 'CANVAS', 'IFRAME']);

export function capturePage() {
  const samples = [];
  const walk = el => {
    if (samples.length >= 3000 || SKIP.has(el.tagName.toUpperCase()) || el.id === 'redraft') return;
    const r = el.getBoundingClientRect();
    if (r.width > 1 && r.height > 1) {
      const c = getComputedStyle(el);
      if (c.visibility !== 'hidden' && +c.opacity > .1) {
        let chars = 0;
        for (const n of el.childNodes) if (n.nodeType === 3) chars += n.nodeValue.trim().length;
        samples.push({
          tag: el.tagName, width: r.width, height: r.height, chars, hasText: chars > 0, color: c.color, fontSize: parseFloat(c.fontSize),
          fontFamily: c.fontFamily, fontWeight: c.fontWeight, letterSpacing: c.letterSpacing, textTransform: c.textTransform,
          backgroundColor: c.backgroundColor, backgroundImage: c.backgroundImage,
          borderWidth: Math.max(parseFloat(c.borderTopWidth), parseFloat(c.borderLeftWidth)), borderColor: c.borderTopColor,
          radius: parseFloat(c.borderTopLeftRadius) || 0, boxShadow: c.boxShadow,
        });
      }
    }
    for (const child of el.children) walk(child);
  };
  walk(document.body);
  const body = getComputedStyle(document.body).backgroundColor, html = getComputedStyle(document.documentElement).backgroundColor;
  return deriveTheme(samples, parseColor(body).a > .5 ? body : html);
}
