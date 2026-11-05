import test from 'node:test';
import assert from 'node:assert/strict';
import { runRedesign } from '../src/pipeline.js';

// A stand-in for client.beta.messages.stream with the same event shape.
function fakeClient(script) {
  const calls = [];
  return {
    calls,
    beta: { messages: { stream(params) {
      calls.push(params);
      const text = script(params);
      return {
        async *[Symbol.asyncIterator]() {
          for (let i = 0; i < text.length; i += 17) yield { type: 'content_block_delta', delta: { type: 'text_delta', text: text.slice(i, i + 17) } };
        },
        finalMessage: async () => ({ stop_reason: 'end_turn', usage: { input_tokens: 100, output_tokens: 50 } }),
      };
    } } },
  };
}

const lines = (...ops) => ops.map(o => JSON.stringify(o)).join('\n');
const page = { outline: 'title: x', sections: [0, 1, 2].map(index => ({ index, tree: `${index + 1} div`, nodes: [], title: 'x' })) };

test('director runs first, workers follow, unsafe ops are dropped', async () => {
  const client = fakeClient(p => p.system[0].text.includes('art director')
    ? lines({ op: 'brief', name: 'Ink', summary: 'Black on cream' }, { op: 'font', family: 'Fraunces' }, { op: 'rule', selector: ':root', css: { '--nx-bg': '#fff' } }, { op: 'rule', selector: 'a', css: { background: 'url(http://evil.test)' } })
    : lines({ op: 'style', id: 1, css: { color: 'red' } }, { op: 'style', id: 2, css: { background: 'url(x)' } }, { op: 'text', id: 3, text: 'hi' }));
  const out = [];
  await runRedesign({ client, model: 'claude-opus-5-5', effort: 'medium', concurrency: 2, page, style: 'ink', allowText: false, emit: m => out.push(m), signal: new AbortController().signal });

  assert.equal(client.calls.length, 4);
  assert.ok(out.findIndex(m => m.type === 'brief') < out.findIndex(m => m.type === 'op' && m.section === 0));
  const ops = out.filter(m => m.type === 'op');
  assert.equal(ops.filter(m => m.section === -1).length, 2);
  assert.equal(ops.filter(m => m.section >= 0).length, 3);
  assert.ok(ops.every(m => m.op.op !== 'text'));
  assert.equal(out.filter(m => m.type === 'section-done').length, 4);
  assert.ok(client.calls[1].system[0].text.includes('Black on cream'));
});

test('requests use adaptive thinking, streaming sized tokens and the fallback beta', async () => {
  const client = fakeClient(() => lines({ op: 'brief', name: 'a', summary: 'b' }));
  await runRedesign({ client, model: 'claude-opus-5-5', effort: 'low', concurrency: 1, page: { ...page, sections: [] }, style: 's', allowText: false, emit() {}, signal: new AbortController().signal });
  const [p] = client.calls;
  assert.deepEqual(p.thinking, { type: 'adaptive' });
  assert.equal(p.max_tokens, 64000);
  assert.equal(p.fallbacks, 'default');
  assert.deepEqual(p.betas, ['server-side-fallback-2026-07-01']);
  assert.equal(p.temperature, undefined);
});

test('models without server fallback do not send it', async () => {
  const client = fakeClient(() => lines({ op: 'brief', name: 'a', summary: 'b' }));
  await runRedesign({ client, model: 'claude-haiku-5-5', effort: 'low', concurrency: 1, page: { ...page, sections: [] }, style: 's', allowText: false, emit() {}, signal: new AbortController().signal });
  assert.equal(client.calls[0].fallbacks, undefined);
  assert.equal(client.calls[0].betas, undefined);
});

test('one failed section does not stop the others', async () => {
  let n = 0;
  const client = fakeClient(p => {
    if (p.system[0].text.includes('art director')) return lines({ op: 'brief', name: 'a', summary: 'b' });
    if (n++ === 0) throw new Error('boom');
    return lines({ op: 'style', id: 1, css: { color: 'red' } });
  });
  const out = [];
  await runRedesign({ client, model: 'claude-opus-5-5', effort: 'low', concurrency: 1, page, style: 's', allowText: false, emit: m => out.push(m), signal: new AbortController().signal });
  assert.equal(out.filter(m => m.type === 'warn').length, 1);
  assert.equal(out.filter(m => m.type === 'section-done').length, 4);
});

test('a director with no brief fails loudly', async () => {
  const client = fakeClient(() => 'nothing useful');
  await assert.rejects(runRedesign({ client, model: 'claude-opus-5-5', effort: 'low', concurrency: 1, page, style: 's', allowText: false, emit() {}, signal: new AbortController().signal }), /no design system/);
});
