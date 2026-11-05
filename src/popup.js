import { PRESETS } from './protocol.js';

const $ = id => document.getElementById(id);
let preset = 'editorial';

for (const [key, p] of Object.entries(PRESETS)) {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = p.label;
  b.className = key === preset ? 'on' : '';
  b.onclick = () => {
    preset = key;
    document.querySelectorAll('#presets button').forEach(x => x.classList.toggle('on', x === b));
    $('style').placeholder = p.prompt;
  };
  $('presets').append(b);
}
$('style').placeholder = PRESETS[preset].prompt;

async function launch(demo) {
  const { apiKey } = await chrome.storage.local.get('apiKey');
  if (!demo && !apiKey) {
    $('msg').textContent = 'Add your Anthropic API key in Options first, or try Demo.';
    chrome.runtime.openOptionsPage();
    return;
  }
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
    const { agents } = await chrome.storage.local.get('agents');
    await chrome.tabs.sendMessage(tab.id, {
      type: 'run',
      settings: { style: $('style').value.trim() || PRESETS[preset].prompt, preset, allowText: $('copy').checked, demo, agents },
    });
    window.close();
  } catch (err) {
    $('msg').textContent = `This page can't be redesigned: ${err.message}`;
  }
}

$('go').onclick = () => launch(false);
$('demo').onclick = () => launch(true);
