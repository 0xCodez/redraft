// Runs agents through the local Claude Code install instead of an API key. The bridge in
// bridge/host.mjs starts `claude -p` for each agent and streams its text back here.
const HOST = 'com.redraft.bridge';

const explain = message => (/not found|forbidden/i.test(message || '')
  ? 'The Claude Code bridge is not set up. In the redraft folder run: npm run connect'
  : message || 'The Claude Code bridge stopped unexpectedly.');

export function claudeCodeProvider({ model } = {}) {
  const port = chrome.runtime.connectNative(HOST);
  const waiting = new Map();
  let next = 0, closed = false;

  port.onMessage.addListener(m => waiting.get(m.id)?.(m));
  port.onDisconnect.addListener(() => {
    closed = true;
    const message = explain(chrome.runtime.lastError?.message);
    for (const handle of waiting.values()) handle({ type: 'fatal', message });
    waiting.clear();
  });

  return {
    run({ system, user, effort, onText, signal }) {
      return new Promise((resolve, reject) => {
        if (closed) return reject(new Error('The Claude Code bridge is not running.'));
        const id = ++next;
        let usage = {}, failure = null;
        const stop = () => { try { port.postMessage({ type: 'cancel', id }); } catch {} };
        signal.addEventListener('abort', stop, { once: true });
        waiting.set(id, m => {
          if (m.type === 'text') onText(m.text);
          else if (m.type === 'usage') usage = m.usage;
          else if (m.type === 'error') failure = m.message;
          else if (m.type === 'fatal') { waiting.delete(id); reject(new Error(m.message)); }
          else if (m.type === 'end') {
            waiting.delete(id);
            signal.removeEventListener('abort', stop);
            if (failure) reject(new Error(failure)); else resolve(usage);
          }
        });
        port.postMessage({ type: 'run', id, system, user, effort, model });
      });
    },
    ping() {
      return new Promise((resolve, reject) => {
        const id = ++next;
        waiting.set(id, m => {
          waiting.delete(id);
          if (m.type === 'pong') resolve(m); else reject(new Error(m.message));
        });
        try { port.postMessage({ type: 'ping', id }); } catch (err) { reject(err); }
      });
    },
    close() { if (!closed) port.disconnect(); },
  };
}
