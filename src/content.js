// The stage, injected into the tab when you click Redesign. Claude's ops arrive in bursts
// and in parallel; this file turns them into one watchable performance. Ops are held per
// section and played top to bottom, each by a cursor that flies out and applies it.
import './swarm.js';
import { collectPage, wirePage } from './snapshot.js';
import { fontImport, ruleToCss } from './protocol.js';
import { planTheme, themeVars } from './theme.js';
import { capturePage } from './capture.js';

const Swarm = globalThis.Swarm;
// Pages turn into a blue blueprint with white lines while they are rebuilt.
Object.assign(Swarm, {
  BLUE: '#ffffff', LINE: '#ffffff', GREY: 'rgba(255,255,255,.2)',
  COLORS: ['#ffffff', '#ff5a1f', '#ffd166', '#9fb6ff', '#7dd3fc', '#ffffff', '#ffb38f', '#d6e0ff'],
});
const { BLUE, GREY } = Swarm;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

const HUD_CSS = `
  :host { all: initial; }
  canvas { position: fixed; inset: 0; width: 100vw; height: 100vh; pointer-events: none; z-index: 2147483646; }
  #hud {
    position: fixed; left: 50%; bottom: 16px; transform: translateX(-50%); z-index: 2147483647;
    display: flex; align-items: center; gap: 11px; height: 44px; padding: 0 7px 0 10px; max-width: calc(100vw - 24px);
    border-radius: 13px; background: rgba(10, 15, 36, .94); border: 1px solid rgba(160, 180, 255, .2);
    box-shadow: 0 14px 40px rgba(4, 8, 30, .55), inset 0 1px 0 rgba(255, 255, 255, .06); backdrop-filter: blur(14px);
    font: 500 12px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, system-ui, sans-serif; color: #f2f4ff; white-space: nowrap; pointer-events: auto;
  }
  #mark { width: 24px; height: 24px; flex: none; display: grid; place-items: center; border-radius: 7px; background: #1237e8; }
  .stat { color: #a3aed6; font-variant-numeric: tabular-nums; } .stat b { color: #fff; font-weight: 650; }
  #status { color: #a3aed6; overflow: hidden; text-overflow: ellipsis; max-width: 280px; }
  #bar { width: 84px; height: 3px; border-radius: 3px; background: rgba(160, 180, 255, .18); overflow: hidden; flex: 0 1 84px; } #bar i { display: block; height: 100%; width: 0; border-radius: 3px; background: #ff5a1f; }
  button { height: 30px; min-width: 30px; padding: 0 11px; border: 0; border-radius: 8px; background: rgba(160, 180, 255, .13); color: #f2f4ff; font: 550 12px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, system-ui, sans-serif; cursor: pointer; }
  button:hover { background: rgba(160, 180, 255, .24); }
  button.main { background: #1237e8; color: #fff; }
  button.main:hover { background: #3457ff; }
  [hidden] { display: none !important; }
  @media (max-width: 620px) { #bar, #tokens-wrap { display: none; } }
`;

function createStage() {
  const host = document.createElement('div');
  host.id = 'redraft';
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = `<style>${HUD_CSS}</style><canvas></canvas>
    <div id="hud" hidden>
      <span id="mark"><svg width="13" height="13" viewBox="30 16 94 98" aria-hidden="true"><path d="M38 28 L66 106 Q68 112 71 106 L84 74 L115 60 Q121 57 115 54 L44 22 Q35 19 38 28 Z" fill="#fff"/></svg></span>
      <span class="stat"><b id="agents">0</b> agents</span>
      <span class="stat"><b id="ops">0</b> edits</span>
      <span class="stat" id="tokens-wrap"><b id="tokens">0</b> tokens</span>
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
  const paper = () => { swarm.veilColor = '18,55,232'; swarm.veilGrid = true; };

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
    if (touched.exportStyles.length < 4000) touched.exportStyles.push({ el, css });
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

  /* ---------- the theme sweep: every element, top to bottom ---------- */

  function startSweep(theme) {
    const grounds = new WeakMap();
    const plan = planTheme(document.body, theme, grounds);
    R.theme = theme;
    R.grounds = grounds;
    applyRule({ selector: ':root', css: themeVars(theme) });
    applyRule({ selector: 'html, body', css: { background: theme.bg, color: theme.text } });

    const sticky = plan.filter(p => p.fixed), flow = plan.filter(p => !p.fixed).sort((a, b) => a.top - b.top);
    const H = document.documentElement.scrollHeight;
    R.sweep = { flow, at: 0, front: 0, H, band: null, duration: clamp(7 + H / 1500, 9, 22), jobs: 0 };
    for (const p of sticky) { applyStyle(p.el, p.css); R.played++; }
    R.received += plan.length;
    R.focus = 0;
    setStatus(`Restyling ${plan.length} elements`);
    watchForNewNodes();
  }

  function sweepStep(dt) {
    const s = R.sweep, H = innerHeight;
    s.front = Math.min(s.H + 40, s.front + dt * s.H / s.duration);
    let chosen = 0;
    while (s.at < s.flow.length && s.flow[s.at].top < s.front) {
      const p = s.flow[s.at++];
      const area = p.width * p.height;
      // Cursors take the visible pieces. The rest land with the sweep line.
      if (p.el.isConnected && chosen < 6 && area > 900 && p.top > scrollY - 100 && p.top < scrollY + H) {
        chosen++;
        const rect = rectOf(p.el, false), r = rect(), big = area > 40000;
        const a = swarm.nearestFree(r.x, r.y) || swarm.spawn(true);
        swarm.assign(a, {
          rect, spray: big || Math.random() < .3,
          ...(big ? { kind: 'draw', mode: 'cross', dur: .5, fill: GREY, handles: true, badge: true } : { kind: 'trace', dur: .22, stroke: BLUE, badge: Math.random() < .3, label: Object.keys(p.css)[0] }),
          onDone() { if (p.el.isConnected) applyStyle(p.el, p.css); },
        });
      } else if (p.el.isConnected) applyStyle(p.el, p.css);
      R.played++;
    }
    // The blueprint lifts along one line, so nothing half-styled is ever shown.
    if (!s.band) { s.band = { x: 0, y: 0, w: innerWidth, h: 0, a: 1, fixed: false }; swarm.holes.push(s.band); }
    s.band.w = innerWidth;
    s.band.h = s.front;
    swarm.line(0, s.front, innerWidth, s.front, { d: .01, life: .25, alpha: .9, color: '#ffffff' });
    R.focus = s.front - innerHeight * .25;
    if (s.front >= s.H + 40 && s.at >= s.flow.length) {
      R.sweep = null;
      R.swept = true;
      R.at = 0;
      setStatus('Agents are refining');
    }
  }

  // Lazy sections and re-rendered components arrive later and need the theme too.
  function watchForNewNodes() {
    touched.observer?.disconnect();
    const theme = R.theme, grounds = R.grounds;
    let pending = [];
    const flush = () => {
      const batch = pending; pending = [];
      if (!touched) return;
      touched.observer?.disconnect();
      for (const el of batch) {
        if (!el.isConnected) continue;
        for (const p of planTheme(el, theme, grounds)) applyStyle(p.el, p.css);
      }
      touched.observer?.observe(document.body, { childList: true, subtree: true });
    };
    touched.observer = new MutationObserver(records => {
      for (const r of records) for (const n of r.addedNodes) if (n.nodeType === 1 && n.id !== 'redraft') pending.push(n);
      if (pending.length) setTimeout(flush, 120);
    });
    touched.observer.observe(document.body, { childList: true, subtree: true });
  }

  function play({ op }) {
    if (op.op === 'font') { applyFont(op.family); return done(); }
    if (op.op === 'theme') { startSweep(op.theme); return done(); }

    const el = op.id != null ? R.page.byId.get(op.id) : firstMatch(op.selector);
    if (op.op !== 'rule' && (!el || !el.isConnected)) return done();

    const fixed = el ? isFixed(el) : true;
    const rect = el ? rectOf(el, fixed) : () => ({ x: innerWidth / 2 - 120, y: 80, w: 240, h: 70 });
    const r = rect();
    const big = r.w * r.h > 40000;
    if (!fixed && R.at >= 0) R.focus = Math.max(R.focusFloor, r.y);

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
      const label = op.op === 'rule' ? op.selector : op.op === 'hide' ? 'hide' : Object.keys(op.css)[0];
      Object.assign(job, big
        ? { kind: 'draw', mode: 'cross', dur: clamp(.3 + Math.sqrt(r.w * r.h) / 1100, .35, .9), fill: GREY, handles: true, badge: true, label: `${Math.round(r.w)} × ${Math.round(r.h)}` }
        : { kind: 'trace', dur: .22, stroke: [BLUE, BLUE, '#ffd166', '#ff5a1f'][Math.random() * 4 | 0], badge: Math.random() < .5, label });
      job.onDone = () => {
        if (op.op === 'rule') applyRule(op);
        else if (op.op === 'hide') applyStyle(el, { display: 'none' });
        else {
          applyStyle(el, op.css);
          if (op.same) for (const twin of R.page.twins.get(op.id) || []) applyStyle(twin, op.css);
        }
        finish(rect());
      };
    }
    const a = swarm.nearestFree(r.x, r.y) || swarm.spawn(true);
    swarm.assign(a, job);

    function finish(box) { if (op.op !== 'rule' && !R?.swept) punch(box, fixed); done(); }
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
    if (R.sweep) { sweepStep(dt); return; }
    const current = R.order[R.at];
    const q = R.queues.get(current) || [];
    R.credit += dt * clamp(9 + q.length / 2, 9, 70);
    while (R.credit >= 1 && q.length) {
      R.credit--;
      try { play(q.shift()); } catch (err) { console.warn('[Redraft] skipped an edit:', err); }
      R.played++;
      if (R.sweep) return;
    }
    R.credit = Math.min(R.credit, 4);
    if (R.waitingFor !== current) { R.waitingFor = current; R.waitStart = performance.now(); }
    if (q.length) R.waitStart = performance.now();
    const patient = performance.now() - R.waitStart < 45000;
    if (!q.length && (R.finished.has(current) || !patient) && !swarm.busy()) {
      const section = R.page.sections[current];
      if (section && !R.swept) {
        for (const el of section.els) if (el.isConnected) { const r = el.getBoundingClientRect(); punch({ x: r.left, y: r.top + scrollY, w: r.width, h: r.height }, false, true); }
      }
      R.at++;
      if (R.at < R.order.length) {
        setStatus(`Refining section ${R.at} of ${R.order.length - 1}`);
        const next = R.page.sections[R.order[R.at]];
        const el = next?.els.find(e => e.isConnected);
        if (el) R.focusFloor = R.focus = el.getBoundingClientRect().top + scrollY;
      }
    }
  }

  function camera(raw, now) {
    if (now < R.userHold) { R.cam = scrollY; return; }
    const max = document.documentElement.scrollHeight - innerHeight;
    const want = clamp(R.focus - innerHeight * .3, 0, Math.max(0, max));
    // Glide, never jump: a long page must stay readable while the camera crosses it.
    const step = (want - R.cam) * (1 - Math.exp(-raw * R.speed * 2.2));
    R.cam += clamp(step, -raw * R.speed * 2600, raw * R.speed * 2600);
    scrollTo({ top: R.cam, behavior: 'instant' });
  }

  function frame(now) {
    if (!R) return;
    try {
      tick(now);
    } catch (err) {
      // A page can throw anything at us. Finish the run rather than leave the blueprint up.
      console.warn('[Redraft] recovering from:', err);
      R.failed = true;
      R.allDone = true;
      R.finished = new Set(R.order);
      R.sweep = null;
      R.swept = true;
    }
    if (R) requestAnimationFrame(frame);
  }

  function tick(now) {
    const gap = (now - R.last) / 1000, raw = Math.min(.05, gap), dt = raw * R.speed;
    R.last = now;

    if (R.phase !== 'exit') {
      R.veilT = R.swept ? Math.max(0, R.veilT - dt / .8) : Math.min(1, R.veilT + dt / .8);
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
      if (R.allDone && !R.sweep && R.at >= R.order.length && !swarm.busy()) {
        R.phase = 'exit'; R.exitT = 1.8;
        swarm.leave();
      }
    } else if (R.phase === 'exit') {
      swarm.veil = Math.max(0, swarm.veil - dt / 1);
      R.exitT -= dt;
      if (R.exitT <= 0) { finish(); return; }
    }
    if (R.allDone && R.failed && R.phase !== 'exit') { R.phase = 'exit'; R.exitT = 1.8; R.swept = true; swarm.leave(); }

    const arena = R.phase !== 'exit' && { x0: 0, x1: innerWidth, y0: scrollY + 8, y1: scrollY + innerHeight - 8 };
    swarm.step(dt, arena);
    swarm.paint();

    $('agents').textContent = swarm.agents.length;
    $('ops').textContent = R.played;
    $('tokens').textContent = R.tokens > 999 ? `${(R.tokens / 1000).toFixed(1)}k` : R.tokens;
    $('fill').style.width = `${R.received ? Math.min(100, R.played / R.received * 100) : 0}%`;
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
    touched = { styles: new Map(), texts: new Map(), exportRules: [], exportStyles: [], observer: null };
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
      received: 0, played: 0, applied: 0, tokens: 0, focusFloor: 0, swept: false, sweep: null, workers: 0, veilT: 0, maxAgents, wantAgents: 70, want() { return this.wantAgents; },
    };
    R.scan = scanQueue();
    for (let n = 0; n < 40; n++) swarm.spawn(false);

    $('hud').hidden = false;
    $('speed').hidden = $('stop').hidden = false;
    $('undo').hidden = $('copy').hidden = $('close').hidden = true;
    $('speed').textContent = '1x';
    setStatus('Scanning page…');
    port.postMessage({ type: 'start', page: wirePage(page), style: settings.style, preset: settings.preset, savedStyle: settings.savedStyle, allowText: settings.allowText, demo: settings.demo });
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
    touched.observer?.disconnect();
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

if (!window.__redraft) {
  window.__redraft = createStage();
  chrome.runtime.onMessage.addListener((message, _sender, reply) => {
    if (message.type === 'run') window.__redraft.run(message.settings);
    if (message.type === 'capture') reply({ theme: capturePage(), source: location.hostname });
  });
}
