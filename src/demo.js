// Offline stand-in for the agents: the same op stream with no calls to Claude. It applies a
// preset's theme, so it shows the swarm and the theme engine but no design judgment.
import { PRESETS, cleanTheme } from './protocol.js';

const wait = (ms, signal) => new Promise(r => { const t = setTimeout(r, ms); signal.addEventListener('abort', () => { clearTimeout(t); r(); }); });

export async function runDemo({ page, preset, savedStyle, emit, signal }) {
  const base = PRESETS[preset] || PRESETS.editorial;
  const raw = savedStyle?.theme || base.demo, label = savedStyle?.name || base.label;
  emit({ type: 'agent', role: 'director', state: 'thinking' });
  await wait(900, signal);
  emit({ type: 'brief', name: `${label} demo` });
  for (const family of new Set([raw.headingFont, raw.bodyFont].filter(Boolean))) emit({ type: 'op', section: -1, op: { op: 'font', family } });
  emit({ type: 'op', section: -1, op: { op: 'theme', theme: cleanTheme(raw) } });
  emit({ type: 'section-done', section: -1 });
  for (const section of page.sections) emit({ type: 'section-done', section: section.index });
}
