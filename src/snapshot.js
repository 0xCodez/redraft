// Reads the live page into a compact text form for the agents. It never reads form values,
// skips password fields, and scrubs emails, long numbers and tokens from every string.
import { scrub } from './protocol.js';

const SKIP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'LINK', 'META', 'HEAD', 'BR', 'WBR']);
const OPAQUE = new Set(['SVG', 'CANVAS', 'VIDEO', 'IFRAME', 'OBJECT', 'EMBED', 'IMG', 'PICTURE', 'INPUT', 'TEXTAREA', 'SELECT']);
const MAX_SECTIONS = 12, MAX_NODES = 220, MAX_TEXT = 90;

const visible = el => {
  const r = el.getBoundingClientRect();
  if (r.width < 2 || r.height < 2) return false;
  const s = getComputedStyle(el);
  return s.visibility !== 'hidden' && s.display !== 'none' && +s.opacity > .02;
};

const hex = c => {
  const m = c.match(/[\d.]+/g);
  if (!m) return '';
  if (m.length > 3 && +m[3] === 0) return '-';
  return `#${m.slice(0, 3).map(n => (+n | 0).toString(16).padStart(2, '0')).join('')}`;
};

const label = el => {
  const tag = el.tagName.toLowerCase();
  const cls = typeof el.className === 'string' ? el.className.trim().split(/\s+/).filter(c => c.length < 24 && !/\d{3}/.test(c)).slice(0, 2) : [];
  return cls.length ? `${tag}.${cls.join('.')}` : tag;
};

const ownText = el => {
  let s = '';
  for (const n of el.childNodes) if (n.nodeType === 3) s += n.nodeValue;
  s = scrub(s.replace(/\s+/g, ' ').trim());
  return s.length > MAX_TEXT ? `${s.slice(0, MAX_TEXT)}…` : s;
};

// Descend through wrappers until the page splits into real blocks, then keep splitting
// anything taller than a couple of screens so a long page gets enough agents.
function findSections(root) {
  let level = [root];
  for (let depth = 0; depth < 7; depth++) {
    const kids = [...level[0].children].filter(e => !SKIP.has(e.tagName) && visible(e));
    const big = kids.filter(e => e.getBoundingClientRect().height > 40);
    if (big.length > 1) { level = big; break; }
    if (!big.length) break;
    level = big;
  }
  const limit = innerHeight * 2.2;
  const split = (el, depth) => {
    if (depth > 3 || el.getBoundingClientRect().height <= limit) return [el];
    const kids = [...el.children].filter(e => !SKIP.has(e.tagName) && visible(e) && e.getBoundingClientRect().height > 40);
    return kids.length > 1 ? kids.flatMap(k => split(k, depth + 1)) : [el];
  };
  const list = level.flatMap(e => split(e, 0));
  // Merge the tail rather than dropping it, so the whole page is covered.
  const out = list.slice(0, MAX_SECTIONS).map(e => [e]);
  list.slice(MAX_SECTIONS).forEach(e => out[out.length - 1].push(e));
  return out;
}

function describeSection(els, index, byId, twins, nextId) {
  const lines = [], nodes = [];
  const parentStyle = new WeakMap();

  const walk = (el, depth, inherited) => {
    if (nodes.length >= MAX_NODES || SKIP.has(el.tagName) || el.id === 'redraft' || !visible(el)) return;
    if (el.tagName === 'INPUT' && el.type === 'password') return;
    const s = getComputedStyle(el), r = el.getBoundingClientRect();
    const id = nextId();
    byId.set(id, el);
    const look = {
      c: hex(s.color), bg: hex(s.backgroundColor), fs: `${Math.round(parseFloat(s.fontSize))}`, fw: s.fontWeight,
      ff: s.fontFamily.split(',')[0].replace(/["']/g, ''), r: s.borderTopLeftRadius === '0px' ? '' : s.borderTopLeftRadius,
    };
    const changed = Object.entries(look).filter(([k, v]) => v && v !== '-' && inherited[k] !== v).map(([k, v]) => `${k}:${v}`).join(' ');
    const text = el.closest('input,textarea,select') ? '' : ownText(el);
    lines.push(`${'  '.repeat(depth)}${id} ${label(el)}${text ? ` "${text}"` : ''} ${Math.round(r.width)}x${Math.round(r.height)}${changed ? ` ${changed}` : ''}`);
    nodes.push([id, el.tagName.toLowerCase(), Math.round(r.width), Math.round(r.height)]);
    parentStyle.set(el, look);
    if (OPAQUE.has(el.tagName.toUpperCase())) return;

    // Cards in a grid are described once; the model styles them together with "same".
    const seen = new Map();
    for (const c of el.children) {
      const key = label(c);
      if (!seen.has(key)) seen.set(key, []);
      seen.get(key).push(c);
    }
    for (const c of el.children) {
      const group = seen.get(label(c));
      if (group.length > 2 && group.indexOf(c) >= 2) continue;
      const before = nodes.length;
      walk(c, depth + 1, look);
      if (group.length > 2 && group[0] === c && nodes.length > before) twins.set(nodes[before][0], group);
    }
    for (const group of seen.values()) {
      if (group.length > 2) lines.push(`${'  '.repeat(depth + 1)}… ${group.length - 2} more like ${label(group[0])}`);
    }
  };

  els.forEach(el => walk(el, 0, {}));
  const heading = els.flatMap(e => [...e.querySelectorAll('h1,h2,h3')]).find(h => h.textContent.trim());
  return { index, tree: lines.join('\n'), nodes, title: heading ? scrub(heading.textContent.trim()).slice(0, 80) : label(els[0]), els };
}

export function collectPage() {
  let n = 0;
  const byId = new Map(), twins = new Map();
  const groups = findSections(document.body);
  const sections = groups.map((els, i) => describeSection(els, i, byId, twins, () => ++n));

  const b = getComputedStyle(document.body);
  const outline = [
    `title: ${scrub(document.title).slice(0, 120)}`,
    `site: ${location.hostname}`,
    `body: bg ${hex(b.backgroundColor)} color ${hex(b.color)} font ${b.fontFamily.split(',')[0]} size ${b.fontSize}`,
    `sections, top to bottom:`,
    ...sections.map(s => `${s.index + 1}. ${s.title} (${s.nodes.length} nodes)\n${s.tree.split('\n').slice(0, 12).join('\n')}`),
  ].join('\n');

  return { outline, sections, byId, twins, nodes: n };
}

// Plain data for the service worker: live elements cannot cross the message boundary.
export const wirePage = page => ({
  outline: page.outline,
  sections: page.sections.map(({ index, tree, nodes, title }) => ({ index, tree, nodes, title })),
});
