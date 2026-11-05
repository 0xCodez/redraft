import { PRESETS } from './protocol.js';
import { loadStyles, saveStyle } from './styles.js';

const $ = id => document.getElementById(id);
const SURPRISE = 'Surprise me: choose a bold, distinctive direction that suits what this page is about.';

let selected = { kind: 'preset', key: 'editorial' };
let styles = [];
let captured = null;

const same = (a, b) => a.kind === b.kind && a.key === b.key;

function swatch(t) {
  const card = document.createElement('span');
  card.className = 'swatch';
  card.style.background = t.bg;
  card.style.color = t.text;
  const aa = document.createElement('b');
  aa.textContent = 'Aa';
  aa.style.fontFamily = `"${t.headingFont}", system-ui, sans-serif`;
  aa.style.fontWeight = t.headingWeight || 700;
  const accent = document.createElement('i');
  accent.style.background = t.accent;
  accent.style.borderRadius = t.pill || '4px';
  const rest = document.createElement('u');
  rest.style.background = t.text;
  rest.style.borderRadius = t.pill || '4px';
  card.append(aa, accent, rest);
  return card;
}

function tile(choice, label, face) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'preset';
  b.setAttribute('aria-pressed', String(same(choice, selected)));
  const name = document.createElement('span');
  name.textContent = label;
  b.append(face, name);
  b.onclick = () => { selected = choice; draw(); };
  return b;
}

const icon = (text, cls) => {
  const s = document.createElement('span');
  s.className = `swatch ${cls}`;
  const b = document.createElement('b');
  b.textContent = text;
  s.append(b);
  return s;
};

function draw() {
  const mine = $('mine'), presets = $('presets');
  mine.replaceChildren();
  presets.replaceChildren();

  const add = document.createElement('button');
  add.type = 'button';
  add.className = 'preset';
  add.innerHTML = '<span class="swatch add"><b>+</b></span><span>New style</span>';
  add.onclick = () => show('create');
  mine.append(add);
  for (const s of styles) mine.append(tile({ kind: 'style', key: s.id }, s.name, s.theme ? swatch(s.theme) : icon('”', 'words')));

  for (const [key, p] of Object.entries(PRESETS)) presets.append(tile({ kind: 'preset', key }, p.label, swatch(p.demo)));
  presets.append(tile({ kind: 'surprise', key: 'surprise' }, 'Surprise me', icon('?', 'surprise')));

  const style = currentStyle();
  $('style').placeholder = style?.theme ? 'Optional notes for the agents' : 'Swiss poster, lots of air, one red accent';
}

const currentStyle = () => (selected.kind === 'style' ? styles.find(s => s.id === selected.key) : null);

function show(view) {
  $('home').hidden = view !== 'home';
  $('create').hidden = view !== 'create';
  $('captured').hidden = true;
  captured = null;
  $('create-msg').textContent = '';
}

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
  return tab;
}

async function finishSave(style) {
  const saved = await saveStyle(style);
  styles = await loadStyles();
  selected = { kind: 'style', key: saved.id };
  show('home');
  draw();
}

$('copy-page').onclick = async () => {
  try {
    const tab = await activeTab();
    const { theme, source } = await chrome.tabs.sendMessage(tab.id, { type: 'capture' });
    captured = { theme, source };
    const row = $('captured-swatch');
    row.replaceChildren(swatch(theme));
    $('captured-colors').replaceChildren(...['bg', 'surface', 'text', 'accent', 'border'].map(k => {
      const dot = document.createElement('i');
      dot.style.background = theme[k];
      dot.title = `${k}: ${theme[k]}`;
      return dot;
    }));
    $('captured-fonts').textContent = [theme.headingFont, theme.bodyFont].filter(Boolean).filter((f, i, a) => a.indexOf(f) === i).join(' + ') || 'System fonts';
    $('captured-name').value = source.replace(/^www\./, '');
    $('captured').hidden = false;
  } catch (err) {
    $('create-msg').textContent = `This page can't be read: ${err.message}`;
  }
};

$('save-captured').onclick = () => finishSave({ name: $('captured-name').value, source: captured.source, theme: captured.theme });

$('save-words').onclick = () => {
  const prompt = $('words').value.trim();
  if (!prompt) { $('create-msg').textContent = 'Describe the style first.'; return; }
  finishSave({ name: $('words-name').value || prompt.slice(0, 24), prompt });
};

$('by-hand').onclick = () => { chrome.tabs.create({ url: chrome.runtime.getURL('options.html#new') }); };
$('back').onclick = () => show('home');
$('settings').onclick = () => chrome.runtime.openOptionsPage();

async function launch(demo) {
  const { apiKey, connection } = await chrome.storage.local.get(['apiKey', 'connection']);
  if (!demo && connection === 'api' && !apiKey) {
    $('msg').textContent = 'Add your Anthropic API key in settings first, or try the demo.';
    chrome.runtime.openOptionsPage();
    return;
  }
  const saved = currentStyle();
  const notes = $('style').value.trim();
  const preset = selected.kind === 'preset' ? PRESETS[selected.key] : null;
  const style = notes || saved?.prompt || preset?.prompt || (saved ? `Keep to the saved style "${saved.name}".` : SURPRISE);
  try {
    const tab = await activeTab();
    const { agents } = await chrome.storage.local.get('agents');
    await chrome.tabs.sendMessage(tab.id, {
      type: 'run',
      settings: {
        style, preset: selected.key, allowText: $('copy').checked, demo, agents,
        savedStyle: saved?.theme ? { name: saved.name, prompt: notes || saved.prompt, theme: saved.theme } : undefined,
      },
    });
    window.close();
  } catch (err) {
    $('msg').textContent = `This page can't be redesigned: ${err.message}`;
  }
}

$('go').onclick = () => launch(false);
$('demo').onclick = () => launch(true);

(async () => {
  styles = await loadStyles();
  if (styles.length) selected = { kind: 'style', key: styles[0].id };
  draw();

  const { connection = 'claude-code', apiKey } = await chrome.storage.local.get(['connection', 'apiKey']);
  const status = $('status');
  if (connection === 'api') {
    status.dataset.state = apiKey ? 'ok' : 'warn';
    status.textContent = apiKey ? 'Using your API key' : 'Add an API key in settings';
    return;
  }
  const result = await chrome.runtime.sendMessage({ type: 'check-bridge' }).catch(() => ({ ok: false }));
  status.dataset.state = result.ok ? 'ok' : 'warn';
  status.textContent = result.ok ? 'Claude Code connected' : 'Claude Code not connected';
})();
