// The contract between Claude and the page. Agents stream one JSON op per line; nothing
// reaches the page until it passes validateOp. Page text is untrusted, and it goes into
// the prompt, so a poisoned page could steer the model. These checks hold either way:
// the only powers an op has are restyling and, when the user opts in, changing text.

const BAD_VALUE = /url\s*\(|image-set\s*\(|image\s*\(|src\s*\(|expression\s*\(|@import|javascript:|<|\\/i;
const BAD_PROP = /^(behavior|-moz-binding)$/i;
const PROP = /^(--[a-z0-9-]{1,40}|-?[a-z][a-z-]{1,40})$/;
const BAD_SELECTOR = /[{}<@\\]|url\s*\(/i;
const MEDIA = /^[a-z0-9 ():.,-]{1,80}$/i;
const FONT = /^[A-Za-z0-9 ]{2,40}$/;
const MAX_VALUE = 400, MAX_SELECTOR = 240, MAX_TEXT = 600;

export function cleanCss(css) {
  if (!css || typeof css !== 'object' || Array.isArray(css)) return null;
  const out = {};
  for (const [prop, value] of Object.entries(css)) {
    const name = prop.toLowerCase();
    if (!PROP.test(name) || BAD_PROP.test(name)) continue;
    const v = typeof value === 'number' ? String(value) : value;
    if (typeof v !== 'string' || !v.trim() || v.length > MAX_VALUE || BAD_VALUE.test(v)) continue;
    out[name] = v.replace(/\s*!important\s*$/i, '').trim();
  }
  return Object.keys(out).length ? out : null;
}

export function validateOp(op, { allowText = false } = {}) {
  if (!op || typeof op !== 'object') return null;
  switch (op.op) {
    case 'brief':
      return { op: 'brief', name: String(op.name || '').slice(0, 60), summary: String(op.summary || '').slice(0, 1200) };
    case 'font':
      return FONT.test(op.family || '') ? { op: 'font', family: op.family } : null;
    case 'rule': {
      const css = cleanCss(op.css);
      const selector = typeof op.selector === 'string' ? op.selector.trim() : '';
      if (!css || !selector || selector.length > MAX_SELECTOR || BAD_SELECTOR.test(selector)) return null;
      const media = typeof op.media === 'string' && MEDIA.test(op.media) ? op.media : undefined;
      return { op: 'rule', selector, css, media };
    }
    case 'style': {
      const css = cleanCss(op.css);
      return css && Number.isInteger(op.id) ? { op: 'style', id: op.id, css } : null;
    }
    case 'hide':
      return Number.isInteger(op.id) ? { op: 'hide', id: op.id } : null;
    case 'text':
      if (!allowText || !Number.isInteger(op.id) || typeof op.text !== 'string') return null;
      return { op: 'text', id: op.id, text: op.text.slice(0, MAX_TEXT) };
    default:
      return null;
  }
}

export function ruleToCss({ selector, css, media }) {
  const body = Object.entries(css).map(([k, v]) => `${k}:${v} !important`).join(';');
  const rule = `${selector}{${body}}`;
  return media ? `@media ${media}{${rule}}` : rule;
}

export function fontImport(family) {
  const name = family.trim().replace(/ +/g, '+');
  return `@import url("https://fonts.googleapis.com/css2?family=${name}:wght@400;500;600;700&display=swap");`;
}

// Models sometimes wrap output in a code fence, so those lines are skipped, not fatal.
export class LineParser {
  constructor(onValue) {
    this.onValue = onValue;
    this.buffer = '';
    this.bad = 0;
  }
  feed(chunk) {
    this.buffer += chunk;
    let at;
    while ((at = this.buffer.indexOf('\n')) >= 0) {
      this.line(this.buffer.slice(0, at));
      this.buffer = this.buffer.slice(at + 1);
    }
  }
  end() {
    this.line(this.buffer);
    this.buffer = '';
  }
  line(raw) {
    const s = raw.trim();
    if (!s || s.startsWith('```')) return;
    try { this.onValue(JSON.parse(s)); } catch { this.bad++; }
  }
}

// Applied to everything read from the page before it is sent anywhere.
export function scrub(text) {
  return text
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '[email]')
    .replace(/\b\d(?:[ -]?\d){5,}\b/g, '[number]')
    .replace(/\b[A-Za-z0-9_-]{32,}\b/g, '[token]');
}

export const PRESETS = {
  editorial: { label: 'Editorial', prompt: 'A confident print-magazine feel: strong serif headlines, generous margins, warm paper tones, one ink accent.', demo: { bg: '#f4efe6', fg: '#1b1a17', soft: '#6b665c', accent: '#b4361e', card: '#fbf8f1', font: 'Fraunces', radius: '2px' } },
  terminal: { label: 'Terminal', prompt: 'A precise developer terminal: near-black, phosphor green accent, monospace everywhere, hairline borders, no shadows.', demo: { bg: '#0a0f0b', fg: '#d6f5dc', soft: '#7ea487', accent: '#4ade80', card: '#101812', font: 'JetBrains Mono', radius: '0px' } },
  glass: { label: 'Soft glass', prompt: 'Calm frosted glass on a deep blue dusk: translucent panels, soft large radii, airy spacing, a single cool accent.', demo: { bg: '#10182e', fg: '#eaf0ff', soft: '#9fb0d6', accent: '#7cc4ff', card: 'rgba(255,255,255,.08)', font: 'Sora', radius: '18px' } },
  brutal: { label: 'Brutalist', prompt: 'Raw neo-brutalism: stark white, thick black borders, hard offset shadows, huge grotesk type, one loud yellow.', demo: { bg: '#ffffff', fg: '#000000', soft: '#333333', accent: '#ffe100', card: '#ffffff', font: 'Archivo Black', radius: '0px' } },
  slop: { label: 'AI slop', prompt: 'Deliberately parody the generic AI landing page: purple-to-blue gradients, glassy cards, glowing buttons, Inter everywhere, oversized rounded corners.', demo: { bg: '#0f0a24', fg: '#f2eeff', soft: '#b5a8e0', accent: '#a855f7', card: 'rgba(168,85,247,.14)', font: 'Inter', radius: '24px' } },
};
