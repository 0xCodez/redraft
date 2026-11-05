// Service worker. Holds the API key, runs the agents, and writes stylesheets through
// chrome.scripting so they work on pages whose CSP blocks inline <style>.
import Anthropic from '@anthropic-ai/sdk';
import { runRedesign } from './pipeline.js';
import { runDemo } from './demo.js';

export const DEFAULTS = { apiKey: '', model: 'claude-opus-5-5', effort: 'medium', concurrency: 4, apiBaseUrl: '' };

const friendly = err => {
  if (err instanceof Anthropic.AuthenticationError) return 'Your API key was rejected. Check it in the extension options.';
  if (err instanceof Anthropic.PermissionDeniedError) return 'This API key cannot use the selected model.';
  if (err instanceof Anthropic.RateLimitError) return 'Rate limited by the API. Wait a minute or lower the agent count in options.';
  if (err instanceof Anthropic.APIConnectionError) return 'Could not reach the Claude API. Check your connection.';
  if (err instanceof Anthropic.APIError) return `Claude API error ${err.status ?? ''}: ${err.message}`;
  return err.message || String(err);
};

chrome.runtime.onConnect.addListener(port => {
  if (port.name !== 'swarm') return;
  const tabId = port.sender.tab.id;
  const target = { tabId, frameIds: [0] };
  const inserted = [];
  const controller = new AbortController();
  const send = message => { try { port.postMessage(message); } catch { controller.abort(); } };
  port.onDisconnect.addListener(() => controller.abort());

  port.onMessage.addListener(async message => {
    if (message.type === 'css') {
      await chrome.scripting.insertCSS({ target, css: message.css, origin: 'AUTHOR' }).catch(err => send({ type: 'warn', message: err.message }));
      inserted.push(message.css);
    } else if (message.type === 'undo') {
      await Promise.all(inserted.splice(0).map(css => chrome.scripting.removeCSS({ target, css, origin: 'AUTHOR' }).catch(() => {})));
    } else if (message.type === 'stop') {
      controller.abort();
    } else if (message.type === 'start') {
      try {
        const { page, style, preset, allowText, demo } = message;
        if (demo) {
          await runDemo({ page, preset, emit: send, signal: controller.signal });
        } else {
          const cfg = { ...DEFAULTS, ...(await chrome.storage.local.get(Object.keys(DEFAULTS))) };
          if (!cfg.apiKey) throw new Error('Add your Anthropic API key in the extension options first.');
          // The key stays in this worker. dangerouslyAllowBrowser is required by the SDK
          // outside Node; here the key belongs to the person running their own extension.
          const client = new Anthropic({ apiKey: cfg.apiKey, dangerouslyAllowBrowser: true, ...(cfg.apiBaseUrl ? { baseURL: cfg.apiBaseUrl } : {}) });
          await runRedesign({ client, model: cfg.model, effort: cfg.effort, concurrency: cfg.concurrency, page, style, allowText, emit: send, signal: controller.signal });
        }
        send({ type: 'done' });
      } catch (err) {
        if (!controller.signal.aborted) send({ type: 'error', message: friendly(err) });
      }
    }
  });
});
