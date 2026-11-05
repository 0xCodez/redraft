// Offline stand-in for the agents: same op stream, no API key, no cost. It restyles by
// tag from a preset, so it shows the swarm rather than real design judgment.
import { PRESETS } from './protocol.js';

const wait = (ms, signal) => new Promise(r => { const t = setTimeout(r, ms); signal.addEventListener('abort', () => { clearTimeout(t); r(); }); });

const HEADING = /^h[1-6]$/;

function styleFor(tag, width, height, t) {
  if (HEADING.test(tag)) return { color: t.fg, 'font-family': `"${t.font}", Georgia, serif`, 'letter-spacing': '-.01em' };
  if (tag === 'a') return { color: t.accent };
  if (tag === 'button') return { background: t.accent, color: t.bg, 'border-radius': t.radius, border: `1px solid ${t.accent}` };
  if (tag === 'p' || tag === 'li') return { color: t.soft, 'line-height': '1.65' };
  if (tag === 'img') return { 'border-radius': t.radius };
  if (['section', 'article', 'div', 'aside', 'nav', 'header', 'footer', 'main'].includes(tag) && width > 120 && height > 40) {
    return { background: t.card, 'border-radius': t.radius, 'border-color': t.soft };
  }
  return null;
}

export async function runDemo({ page, preset, emit, signal }) {
  const theme = (PRESETS[preset] || PRESETS.editorial).demo;
  emit({ type: 'agent', role: 'director', state: 'thinking' });
  await wait(900, signal);
  emit({ type: 'brief', name: `${PRESETS[preset]?.label || 'Editorial'} demo` });
  emit({ type: 'op', section: -1, op: { op: 'font', family: theme.font } });
  for (const [selector, css] of [
    [':root', { '--nx-bg': theme.bg, '--nx-fg': theme.fg, '--nx-accent': theme.accent }],
    ['html', { background: theme.bg }],
    ['body', { background: theme.bg, color: theme.fg, 'font-family': `"${theme.font}", system-ui, sans-serif` }],
    ['a:hover', { color: theme.fg }],
  ]) {
    await wait(120, signal);
    emit({ type: 'op', section: -1, op: { op: 'rule', selector, css } });
  }
  emit({ type: 'section-done', section: -1 });

  await Promise.all(page.sections.map(async section => {
    emit({ type: 'agent', role: 'worker', state: 'writing', section: section.index });
    for (const [id, tag, w, h] of section.nodes) {
      if (signal.aborted) return;
      const css = styleFor(tag, w, h, theme);
      if (!css) continue;
      await wait(14, signal);
      emit({ type: 'op', section: section.index, op: { op: 'style', id, css } });
    }
    emit({ type: 'section-done', section: section.index });
  }));
}
