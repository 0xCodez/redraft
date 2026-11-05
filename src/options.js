const defaults = { apiKey: '', model: 'claude-opus-5-5', effort: 'medium', concurrency: 4, agents: 240 };
const $ = id => document.getElementById(id);

const stored = await chrome.storage.local.get(Object.keys(defaults));
for (const [key, value] of Object.entries({ ...defaults, ...stored })) $(key).value = value;

$('save').onclick = async () => {
  await chrome.storage.local.set({
    apiKey: $('apiKey').value.trim(),
    model: $('model').value,
    effort: $('effort').value,
    concurrency: Math.min(8, Math.max(1, +$('concurrency').value || 4)),
    agents: Math.min(400, Math.max(20, +$('agents').value || 240)),
  });
  $('saved').textContent = 'Saved';
};
