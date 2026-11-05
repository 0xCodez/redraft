// The user's style library. A style is either a theme (copied from a page or built by hand)
// or a written direction. Stored locally; a JSON file moves styles between browsers.
import { cleanTheme } from './protocol.js';

const KEY = 'styles';
const id = () => `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export async function loadStyles() {
  const { [KEY]: list } = await chrome.storage.local.get(KEY);
  return Array.isArray(list) ? list : [];
}

async function write(list) { await chrome.storage.local.set({ [KEY]: list }); }

export async function saveStyle(style) {
  const list = await loadStyles();
  const clean = sanitizeStyle(style);
  if (!clean) throw new Error('This style is missing colours or a description.');
  const at = list.findIndex(s => s.id === clean.id);
  if (at >= 0) list[at] = clean; else list.unshift(clean);
  await write(list);
  return clean;
}

export async function removeStyle(styleId) {
  await write((await loadStyles()).filter(s => s.id !== styleId));
}

// Imported files are untrusted, so they pass the same checks as anything Claude writes.
export function sanitizeStyle(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const name = String(raw.name || '').trim().slice(0, 40) || 'Untitled style';
  const source = String(raw.source || '').slice(0, 80);
  const prompt = typeof raw.prompt === 'string' ? raw.prompt.trim().slice(0, 800) : '';
  const theme = raw.theme && cleanTheme(raw.theme) ? raw.theme : null;
  if (!theme && !prompt) return null;
  return { id: typeof raw.id === 'string' && raw.id ? raw.id.slice(0, 40) : id(), name, source, prompt, theme };
}

export function importStyles(text) {
  const parsed = JSON.parse(text);
  const list = (Array.isArray(parsed) ? parsed : [parsed]).map(s => sanitizeStyle({ ...s, id: '' })).filter(Boolean);
  if (!list.length) throw new Error('No valid styles in this file.');
  return list;
}

export const exportStyles = list => JSON.stringify(list.map(({ id: _id, ...rest }) => rest), null, 2);
