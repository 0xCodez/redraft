import { exportStyles, importStyles, loadStyles, removeStyle, saveStyle } from './styles.js';

const defaults = { connection: 'claude-code', apiKey: '', model: 'claude-opus-5-5', effort: 'medium', concurrency: 4, agents: 240 };
const $ = id => document.getElementById(id);

const stored = await chrome.storage.local.get(Object.keys(defaults));
for (const [key, value] of Object.entries({ ...defaults, ...stored })) $(key).value = value;

const buttons = [...document.querySelectorAll('[data-connection]')];
const showGroup = () => {
  const on = $('connection').value;
  $('bridge').hidden = on !== 'claude-code';
  $('api').hidden = on !== 'api';
  buttons.forEach(b => b.setAttribute('aria-pressed', String(b.dataset.connection === on)));
};
buttons.forEach(b => { b.onclick = () => { $('connection').value = b.dataset.connection; showGroup(); }; });
showGroup();

$('check').onclick = async () => {
  $('checked').dataset.state = '';
  $('checked').textContent = 'Checking…';
  const result = await chrome.runtime.sendMessage({ type: 'check-bridge' });
  $('checked').dataset.state = result.ok ? 'ok' : 'warn';
  $('checked').textContent = result.ok ? `Connected: ${result.version}` : result.message;
};

$('save').onclick = async () => {
  await chrome.storage.local.set({
    connection: $('connection').value,
    apiKey: $('apiKey').value.trim(),
    model: $('model').value,
    effort: $('effort').value,
    concurrency: Math.min(8, Math.max(1, +$('concurrency').value || 4)),
    agents: Math.min(400, Math.max(20, +$('agents').value || 240)),
  });
  $('saved').textContent = 'Saved';
};

/* ---------- your styles ---------- */

const COLORS = [['bg', 'Page', '#ffffff'], ['surface', 'Cards', '#f4f4f2'], ['text', 'Text', '#111111'], ['muted', 'Muted', '#666666'], ['accent', 'Accent', '#1237e8'], ['accentText', 'On accent', '#ffffff'], ['border', 'Border', '#dddddd']];
let editing = null;

for (const [key, label] of COLORS) {
  const row = document.createElement('label');
  const input = document.createElement('input');
  input.type = 'color';
  input.id = `e-${key}`;
  row.append(input, label);
  $('e-colors').append(row);
}

const say = text => { $('library-msg').textContent = text; };

async function drawLibrary() {
  const styles = await loadStyles();
  const list = $('style-list');
  list.replaceChildren();
  if (!styles.length) say('No styles yet. Copy one from any site in the Redraft popup, or press New.');
  for (const s of styles) {
    const li = document.createElement('li');
    const chip = document.createElement('span');
    chip.className = 'chip';
    chip.textContent = 'Aa';
    chip.style.background = s.theme?.bg || 'var(--raise)';
    chip.style.color = s.theme?.accent || 'var(--soft)';
    const info = document.createElement('span');
    info.className = 'info';
    const name = document.createElement('b');
    name.textContent = s.name;
    const from = document.createElement('small');
    from.textContent = s.source || (s.theme ? 'Built by hand' : 'Written direction');
    info.append(name, from);
    const edit = document.createElement('button');
    edit.className = 'quiet';
    edit.type = 'button';
    edit.textContent = 'Edit';
    edit.onclick = () => openEditor(s);
    const del = document.createElement('button');
    del.className = 'quiet';
    del.type = 'button';
    del.textContent = 'Delete';
    del.onclick = async () => { await removeStyle(s.id); drawLibrary(); };
    li.append(chip, info, edit, del);
    list.append(li);
  }
}

function openEditor(style) {
  editing = style;
  const t = style?.theme || {};
  $('editor').hidden = false;
  $('editor-title').textContent = style ? `Edit ${style.name}` : 'New style';
  $('e-name').value = style?.name || '';
  for (const [key, , fallback] of COLORS) $(`e-${key}`).value = /^#[0-9a-f]{6}$/i.test(t[key] || '') ? t[key] : fallback;
  $('e-headingFont').value = t.headingFont || '';
  $('e-bodyFont').value = t.bodyFont || '';
  $('e-radius').value = t.radius || '8px';
  $('e-headingWeight').value = t.headingWeight || 700;
  $('e-shadow').value = t.shadow || 'none';
  $('e-prompt').value = style?.prompt || '';
  $('editor').scrollIntoView({ behavior: 'smooth' });
}

$('new-style').onclick = () => openEditor(null);
$('e-cancel').onclick = () => { $('editor').hidden = true; };
$('e-save').onclick = async () => {
  const theme = { ...(editing?.theme || {}) };
  for (const [key] of COLORS) theme[key] = $(`e-${key}`).value;
  Object.assign(theme, {
    headingFont: $('e-headingFont').value.trim(), bodyFont: $('e-bodyFont').value.trim(), radius: $('e-radius').value.trim() || '8px',
    headingWeight: +$('e-headingWeight').value || 700, shadow: $('e-shadow').value.trim() || 'none',
  });
  try {
    await saveStyle({ id: editing?.id, source: editing?.source, name: $('e-name').value, prompt: $('e-prompt').value, theme });
    $('editor').hidden = true;
    say('Style saved. It is ready in the Redraft popup.');
    drawLibrary();
  } catch (err) { say(err.message); }
};

$('export').onclick = async () => {
  const blob = new Blob([exportStyles(await loadStyles())], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'redraft-styles.json';
  a.click();
  URL.revokeObjectURL(a.href);
};
$('import').onclick = () => $('import-file').click();
$('import-file').onchange = async e => {
  try {
    const list = importStyles(await e.target.files[0].text());
    for (const s of list) await saveStyle(s);
    say(`Imported ${list.length} ${list.length === 1 ? 'style' : 'styles'}.`);
    drawLibrary();
  } catch (err) { say(err.message); }
  e.target.value = '';
};

drawLibrary();
if (location.hash === '#new') openEditor(null);
