// The stage, injected into the tab when you click Redesign. Claude's ops arrive in bursts
// and in parallel; this file turns them into one watchable performance. Ops are held per
// section and played top to bottom, each by a cursor that flies out and applies it.
import './swarm.js';
import { collectPage, wirePage } from './snapshot.js';
import { fontImport, ruleToCss } from './protocol.js';

const Swarm = globalThis.Swarm;
// The 0xCodez look: pages turn into a red blueprint with white lines while they are rebuilt.
Object.assign(Swarm, {
  BLUE: '#ffffff', LINE: '#ffffff', GREY: 'rgba(255,255,255,.2)',
  COLORS: ['#ffffff', '#ffd166', '#ffb4a8', '#111111', '#7dd3fc', '#ffe3de', '#ff9c8e', '#fff3b0'],
});
const { BLUE, GREY } = Swarm;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

const HUD_CSS = `
  :host { all: initial; }
  canvas { position: fixed; inset: 0; width: 100vw; height: 100vh; pointer-events: none; z-index: 2147483646; }
  #hud {
    position: fixed; left: 50%; bottom: 14px; transform: translateX(-50%); z-index: 2147483647;
    display: flex; align-items: center; gap: 10px; height: 38px; padding: 0 6px 0 12px; max-width: calc(100vw - 24px);
    border-radius: 11px; background: rgba(30,32,30,.94); border: 1px solid rgba(255,255,255,.1); box-shadow: 0 8px 28px rgba(0,0,0,.5);
    font: 500 11.5px/1 Inter, system-ui, sans-serif; color: #e7e7e4; white-space: nowrap; pointer-events: auto;
  }
  #dots { display: inline-flex; } #dots i { width: 12px; height: 12px; border-radius: 50%; margin-left: -4px; box-shadow: 0 0 0 1px rgba(0,0,0,.35); }
  #dots i:first-child { margin-left: 0; }
  .stat { color: #bdbdb8; font-variant-numeric: tabular-nums; } .stat b { color: #fff; font-weight: 600; }
  #status { color: #bdbdb8; overflow: hidden; text-overflow: ellipsis; max-width: 300px; }
  #bar { width: 90px; height: 2px; border-radius: 2px; background: rgba(255,255,255,.16); overflow: hidden; flex: 0 1 90px; } #bar i { display: block; height: 100%; width: 0; background: #e3170a; }
  button { height: 26px; min-width: 26px; padding: 0 9px; border: 0; border-radius: 6px; background: rgba(255,255,255,.09); color: #e7e7e4; font: 500 11px/1 Inter, system-ui, sans-serif; cursor: pointer; }
  button:hover { background: rgba(255,255,255,.17); }
  button.main { background: #d90b0b; color: #fff; }
  [hidden] { display: none !important; }
`;

function createStage() {
  const host = document.createElement('div');
  host.id = 'codez-swarm';
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = `<style>${HUD_CSS}</style><canvas></canvas>
    <div id="hud" hidden>
      <span id="dots">${Swarm.COLORS.slice(0, 5).map(c => `<i style="background:${c}"></i>`).join('')}</span>
      <span class="stat"><b id="agents">0</b> agents</span>
      <span class="stat"><b id="ops">0</b> edits</span>
      <span class="stat"><b id="tokens">0</b> tokens</span>
      <span id="status"></span>
      <span id="bar"><i id="fill"></i></span>
      <button id="speed" title="Change speed">1x</button>
      <button id="stop" title="Stop the agents">Stop</button>
      <button id="undo" class="main" hidden>Undo</button>
      <button id="copy" hidden>Copy CSS</button>
      <button id="close" hidden aria-label="Close">×</button>
    </div>`;
  document.documentElement.append(host);
  const $ = id => root.getElementById(id);
  const swarm = new Swarm(root.querySelector('canvas'), { maxLines: 1500 });
  const paper = () => { swarm.veilColor = '196,12,8'; swarm.veilGrid = true; };

  let R = null;           // the current run
  let touched = null;     // what Undo restores; survives the end of a run
  let port = null;

  const setStatus = s => { $('status').textContent = s; };

  /* ---------- applying ops to the real page ---------- */

  function remember(el) {
    if (!touched.styles.has(el)) touched.styles.set(el, el.getAttribute('style'));
  }
  function applyStyle(el, css) {
    remember(el);
    for (const [k, v] of Object.entries(css)) el.style.setProperty(k, v, 'important');
    touched.exportStyles.push({ el, css });
  }
  function applyRule(op) {
    const css = ruleToCss(op);
    port.postMessage({ type: 'css', css });
    touched.exportRules.push(css);
  }
  function applyFont(family) {
    const css = fontImport(family);
    port.postMessage({ type: 'css', css });
    touched.exportRules.unshift(css);
  }

  const rectOf = (el, fixed) => () => {
    const r = el.getBoundingClientRect();
    return { x: r.left, y: r.top + (fixed ? 0 : scrollY), w: r.width, h: r.height };
  };
  const isFixed = el => {
    for (let e = el; e && e !== document.body; e = e.parentElement) {
      const p = getComputedStyle(e).position;
      if (p === 'fixed' || p === 'sticky') return true;
    }
    return false;
  };
  // Wrappers and page-wide rules must not lift the blueprint early: a section is only
  // revealed whole once its agent has finished.
  function punch(r, fixed, whole) {
    if (!whole && r.h > innerHeight * .55) return;
    if (swarm.holes.length > 900) swarm.holes.shift();
    swarm.holes.push({ x: r.x, y: r.y, w: r.w, h: r.h, a: 0, fixed });
  }

  const firstMatch = selector => {
    try { return document.querySelector(selector.replace(/:{1,2}(hover|focus|focus-visible|active|before|after)/g, '')); } catch { return null; }
  };

  /* ---------- turning one op into one cursor's job ---------- */

  function play({ op }) {
    if (op.op === 'font') { applyFont(op.family); return done(); }

    const el = op.id != null ? R.page.byId.get(op.id) : firstMatch(op.selector);
    if (op.op !== 'rule' && (!el || !el.isConnected)) return done();

    const fixed = el ? isFixed(el) : true;
    const rect = el ? rectOf(el, fixed) : () => ({ x: innerWidth / 2 - 120, y: 80, w: 240, h: 70 });
    const r = rect();
    const big = r.w * r.h > 40000;
    R.focus = fixed ? R.focus : r.y;

    const job = { rect, fixed, spray: big || Math.random() < .35 };
    if (op.op === 'text') {
      Object.assign(job, {
        kind: 'type', mode: 'ibeam', dur: clamp(op.text.length / 120, .25, 1.4), handles: true,
        onStart() { remember(el); if (!touched.texts.has(el)) touched.texts.set(el, el.innerHTML); },
        onTick(p, a) {
          el.textContent = op.text.slice(0, Math.round(op.text.length * p));
          const c = el.getBoundingClientRect();
          a.x = c.right; a.y = c.top + scrollY + c.height / 2;
        },
        onDone() { el.textContent = op.text; finish(rect()); },
      });
    } else {
      const label = op.op === 'rule' ? op.selector : Object.keys(op.css)[0];
      Object.assign(job, big
        ? { kind: 'draw', mode: 'cross', dur: clamp(.3 + Math.sqrt(r.w * r.h) / 1100, .35, .9), fill: GREY, handles: true, badge: true, label: `${Math.round(r.w)} × ${Math.round(r.h)}` }
        : { kind: 'trace', dur: .22, stroke: [BLUE, BLUE, '#ffd166', '#111111'][Math.random() * 4 | 0], badge: Math.random() < .5, label });
      job.onDone = () => {
        if (op.op === 'rule') applyRule(op);
        else if (op.op === 'hide') applyStyle(el, { display: 'none' });
        else applyStyle(el, op.css);
        finish(rect());
      };
    }
    const a = swarm.nearestFree(r.x, r.y) || swarm.spawn(true);
    swarm.assign(a, job);

    function finish(box) { if (op.op !== 'rule') punch(box, fixed); done(); }
  }

  function done() {
    R.applied++;
  }

  /* ---------- the show ---------- */

  function feed(message) {
    if (!R) return;
    const q = R.queues;
    switch (message.type) {
      case 'agent':
        if (message.role === 'director') setStatus('Director is reading the page');
        if (message.role === 'worker') { R.workers++; R.wantAgents = Math.min(R.maxAgents, R.wantAgents + 34); }
        break;
      case 'brief': setStatus(message.name); R.phase = 'build'; break;
      case 'op': (q.get(message.section) || q.set(message.section, []).get(message.section)).push(message); R.received++; break;
      case 'section-done': R.finished.add(message.section); break;
      case 'usage': R.tokens += message.input + message.output; break;
      case 'warn': console.warn('[Swarm]', message.message); break;
      case 'done': R.allDone = true; break;
      case 'error': setStatus(message.message); R.failed = true; R.allDone = true; R.finished = new Set(R.order); break;
    }
  }

  function scanQueue() {
    const els = [...R.page.byId.values()].filter(e => e.getBoundingClientRect().top < innerHeight * 2.5);
    return els.slice(0, 500).sort(() => Math.random() - .5);
  }

  function wireframe(r, color) {
    const { x, y, w, h } = r, o = { keep: true, alpha: .32, d: .3, color };
    swarm.line(x, y, x + w, y, o); swarm.line(x + w, y, x + w, y + h, o); swarm.line(x + w, y + h, x, y + h, o); swarm.line(x, y + h, x, y, o);
  }

  // While Claude thinks, the swarm surveys the page and draws its blueprint on the veil.
  function survey() {
    for (let n = 0; n < 3 && R.scan.length; n++) {
      const a = swarm.nearestFree(innerWidth / 2, scrollY + innerHeight / 2);
      if (!a) return;
      const el = R.scan.pop();
      if (!el.isConnected) continue;
      const fixed = isFixed(el), rect = rectOf(el, fixed), r = rect();
      if (r.w < 6 || r.h < 6 || r.y - (fixed ? 0 : scrollY) > innerHeight * 1.2) continue;
      swarm.assign(a, { rect, fixed, kind: 'trace', dur: .3, spray: Math.random() < .25, onDone: () => { if (!fixed) wireframe(r, BLUE); } });
    }
  }

  function direct(dt) {
    const current = R.order[R.at];
    const q = R.queues.get(current) || [];
    const backlog = q.length;
    R.credit += dt * clamp(9 + backlog / 2, 9, 70);
    while (R.credit >= 1 && q.length) {
      R.credit--;
      play(q.shift());
      R.played++;
    }
    R.credit = Math.min(R.credit, 4);
    if (!q.length && R.finished.has(current) && !swarm.busy()) {
      const section = R.page.sections[current];
      if (section) {
        for (const el of section.els) if (el.isConnected) { const r = el.getBoundingClientRect(); punch({ x: r.left, y: r.top + scrollY, w: r.width, h: r.height }, false, true); }
      }
      R.at++;
      if (R.at < R.order.length) setStatus(`Section ${R.at} of ${R.order.length - 1}`);
    }
  }

  function camera(raw, now) {
    if (now < R.userHold) { R.cam = scrollY; return; }
    const max = document.documentElement.scrollHeight - innerHeight;
    const want = clamp(R.focus - innerHeight * .4, 0, Math.max(0, max));
    R.cam += (want - R.cam) * (1 - Math.exp(-raw * R.speed * 1.4));
    scrollTo({ top: R.cam, behavior: 'instant' });
  }

  function frame(now) {
    if (!R) return;
    const gap = (now - R.last) / 1000, raw = Math.min(.05, gap), dt = raw * R.speed;
    R.last = now;

    if (R.phase !== 'exit') {
      R.veilT = Math.min(1, R.veilT + dt / .8);
      swarm.veil = .95 * R.veilT;
    }
    if (R.want() > swarm.agents.length) swarm.spawn(true).rest = 0;

    if (R.phase === 'scan') {
      R.clock += Math.min(.5, gap) * R.speed;
      if (R.clock < 1.2) swarm.orbit(innerWidth / 2, innerHeight / 2);
      else { R.phase = 'survey'; }
    } else if (R.phase === 'survey') {
      survey();
      if (R.queues.size) R.phase = 'build';
    } else if (R.phase === 'build') {
      direct(dt);
      camera(raw, now);
      if (R.allDone && R.at >= R.order.length && !swarm.busy()) {
        R.phase = 'exit'; R.exitT = 1.8;
        swarm.leave();
      }
    } else if (R.phase === 'exit') {
      swarm.veil = Math.max(0, swarm.veil - dt / 1);
      R.exitT -= dt;
      if (R.exitT <= 0) { finish(); return; }
    }
    if (R.allDone && R.failed && R.phase !== 'exit') { R.phase = 'exit'; R.exitT = 1.8; swarm.leave(); }

    const arena = R.phase !== 'exit' && { x0: 0, x1: innerWidth, y0: scrollY + 8, y1: scrollY + innerHeight - 8 };
    swarm.step(dt, arena);
    swarm.paint();

    $('agents').textContent = swarm.agents.length;
    $('ops').textContent = R.played;
    $('tokens').textContent = R.tokens > 999 ? `${(R.tokens / 1000).toFixed(1)}k` : R.tokens;
    $('fill').style.width = `${R.received ? R.played / R.received * 100 : 0}%`;
    requestAnimationFrame(frame);
  }

  function finish() {
    const run = R;
    R = null;
    swarm.clear();
    swarm.reset();
    if (!run.failed) setStatus(`Done in ${Math.round((performance.now() - run.started) / 1000)}s`);
    $('speed').hidden = $('stop').hidden = true;
    $('undo').hidden = $('copy').hidden = $('close').hidden = false;
    if (performance.now() > run.userHold) scrollTo({ top: 0, behavior: 'smooth' });
  }

  function run(settings) {
    if (R) return;
    if (touched) undo();
    const page = collectPage();
    touched = { styles: new Map(), texts: new Map(), exportRules: [], exportStyles: [] };
    port?.disconnect();
    port = chrome.runtime.connect({ name: 'swarm' });
    port.onMessage.addListener(feed);
    port.onDisconnect.addListener(() => { port = null; });
    const ping = setInterval(() => { try { port ? port.postMessage({ type: 'ping' }) : clearInterval(ping); } catch { clearInterval(ping); } }, 20000);

    swarm.reset();
    swarm.resize();
    paper();
    const maxAgents = settings.agents || 240;
    R = {
      page, phase: 'scan', clock: 0, last: performance.now(), started: performance.now(), speed: 1, userHold: 0, cam: scrollY, focus: scrollY + innerHeight * .4,
      queues: new Map(), order: [-1, ...page.sections.map(s => s.index)], at: 0, finished: new Set(), credit: 0,
      received: 0, played: 0, applied: 0, tokens: 0, workers: 0, veilT: 0, maxAgents, wantAgents: 70, want() { return this.wantAgents; },
    };
    R.scan = scanQueue();
    for (let n = 0; n < 40; n++) swarm.spawn(false);

    $('hud').hidden = false;
    $('speed').hidden = $('stop').hidden = false;
    $('undo').hidden = $('copy').hidden = $('close').hidden = true;
    $('speed').textContent = '1x';
    setStatus('Scanning page…');
    port.postMessage({ type: 'start', page: wirePage(page), style: settings.style, preset: settings.preset, allowText: settings.allowText, demo: settings.demo });
    requestAnimationFrame(frame);
  }

  function stop() {
    if (!R) return;
    port?.postMessage({ type: 'stop' });
    R.failed = true; R.phase = 'exit'; R.exitT = 1.2;
    swarm.leave();
    setStatus('Stopped');
  }

  function undo() {
    if (!touched) return;
    for (const [el, style] of touched.styles) { if (style == null) el.removeAttribute('style'); else el.setAttribute('style', style); }
    for (const [el, html] of touched.texts) el.innerHTML = html;
    port?.postMessage({ type: 'undo' });
    touched = null;
    setStatus('Original page restored');
    $('undo').hidden = $('copy').hidden = true;
  }

  const selectorFor = el => {
    if (el.id) return `#${CSS.escape(el.id)}`;
    const path = [];
    for (let e = el; e && e !== document.body && path.length < 6; e = e.parentElement) {
      if (e.id) { path.unshift(`#${CSS.escape(e.id)}`); break; }
      const same = [...(e.parentElement?.children || [])].filter(c => c.tagName === e.tagName);
      path.unshift(`${e.tagName.toLowerCase()}${same.length > 1 ? `:nth-of-type(${same.indexOf(e) + 1})` : ''}`);
    }
    return path.join(' > ');
  };

  function exportCss() {
    const rules = touched.exportStyles.map(({ el, css }) => ruleToCss({ selector: selectorFor(el), css }));
    return [`/* Swarm redesign of ${location.hostname} */`, ...touched.exportRules, ...rules].join('\n');
  }

  $('speed').onclick = () => {
    if (!R) return;
    R.speed = R.speed === 1 ? 2 : R.speed === 2 ? 4 : 1;
    $('speed').textContent = `${R.speed}x`;
  };
  $('stop').onclick = stop;
  $('undo').onclick = undo;
  $('close').onclick = () => { $('hud').hidden = true; };
  $('copy').onclick = async () => {
    if (!touched) return;
    try {
      await navigator.clipboard.writeText(exportCss());
      setStatus('CSS copied');
    } catch {
      setStatus('Copy was blocked on this page');
    }
  };

  const hold = () => { if (R) R.userHold = performance.now() + 1800; };
  addEventListener('wheel', hold, { passive: true });
  addEventListener('touchmove', hold, { passive: true });
  addEventListener('resize', () => swarm.resize());

  return { run, stop, undo, get running() { return !!R; }, exportCss };
}

if (!window.__codezSwarm) {
  window.__codezSwarm = createStage();
  chrome.runtime.onMessage.addListener(message => {
    if (message.type === 'run') window.__codezSwarm.run(message.settings);
  });
}
