// The landing page redesigns itself with the extension's own swarm engine. It opens as plain
// HTML, goes under the blueprint, switches on the stylesheet there, and the cursors reveal the
// real elements one by one. Afterwards a named crew stays on the page: it keeps working on
// real elements, follows the pointer and redrafts the demo window in a loop.
(() => {
  const root = document.documentElement;
  const canvas = document.getElementById('swarm-canvas');
  const design = document.getElementById('design');
  const hud = document.getElementById('hud');
  const $ = id => document.getElementById(id);

  const swarm = new Swarm(canvas, { maxLines: 1400 });
  const MOODS = {
    // White on the blueprint while the page is being rebuilt.
    build: {
      BLUE: '#ffffff', LINE: '#ffffff', GREY: 'rgba(255,255,255,.22)', INK: '#ffffff', OUTLINE: 'rgba(0,0,0,.4)',
      COLORS: ['#ffffff', '#ff5a1f', '#ffd166', '#9fb6ff', '#7dd3fc', '#ffffff', '#ffb38f', '#d6e0ff'],
    },
    // A white outline keeps the crew visible on blue, white and dark sections alike.
    crew: {
      BLUE: '#ff5a1f', LINE: '#ff5a1f', GREY: 'rgba(255,90,31,.2)', INK: '#0a0f24', OUTLINE: 'rgba(255,255,255,.95)',
      COLORS: ['#ff5a1f', '#1237e8', '#0a0f24', '#00a88f', '#e0267a', '#7c3aed'],
    },
  };
  const mood = name => Object.assign(Swarm, MOODS[name]);
  mood('build');

  const phone = () => innerWidth < 700;
  const CAP = () => phone() ? 110 : 240;
  const VEIL = .96;
  const NAMES = ['Director', 'Type', 'Color', 'Layout', 'Spacing', 'Review'];
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const rand = (a, b) => a + Math.random() * (b - a);
  const LABELS = ['font-family', 'border-radius', 'letter-spacing', 'background', 'line-height', 'padding', 'color', 'box-shadow'];

  let R = null;   // a rebuild in progress
  let A = null;   // the crew at work afterwards

  /* ---------- layers ---------- */

  function layers(onlyViewport) {
    const y0 = scrollY, H = innerHeight;
    const sections = [...document.querySelectorAll('[data-sec]')];
    const items = [...document.querySelectorAll('[data-b]')].map(el => {
      const rects = el.getClientRects();
      if (!rects.length) return null;
      const r = el.getBoundingClientRect();
      return {
        el, kind: el.dataset.b, crowd: +el.dataset.s || 0, fixed: 'fixed' in el.dataset, top: r.top + y0, left: r.left, w: r.width, h: r.height,
        len: el.textContent.trim().length, sec: sections.findIndex(s => s.contains(el)),
      };
    }).filter(i => i && (!onlyViewport || i.fixed || (i.top < y0 + H && i.top + i.h > y0)));
    items.forEach(i => { i.key = (i.fixed ? 0 : i.top) + rand(0, 26) + (i.kind === 'shape' ? -30 : 0); });
    return items.sort((a, b) => a.key - b.key);
  }

  const rectOf = i => () => {
    const r = i.el.getBoundingClientRect();
    return { x: r.left, y: r.top + (i.fixed ? 0 : scrollY), w: r.width, h: r.height };
  };

  function hole(r, fixed, section) {
    if (!section && r.h > innerHeight * .7) return;
    swarm.holes.push({ x: r.x, y: r.y, w: r.w, h: r.h, a: 0, fixed });
  }

  /* ---------- typing into the real text ---------- */

  function hideText(i) {
    const walk = document.createTreeWalker(i.el, NodeFilter.SHOW_TEXT), nodes = [];
    while (walk.nextNode()) if (walk.currentNode.nodeValue.trim()) nodes.push(walk.currentNode);
    i.parts = nodes.map(n => {
      const a = document.createTextNode(''), b = document.createElement('span');
      b.className = 't-rest';
      b.textContent = n.nodeValue;
      const full = n.nodeValue;
      n.replaceWith(a, b);
      return { n, a, b, full };
    });
    i.total = i.parts.reduce((s, p) => s + p.full.length, 0);
    i.typed = 0;
  }
  function typeTo(i, chars) {
    if (chars <= i.typed) return;
    let left = chars;
    for (const p of i.parts) {
      const c = clamp(left, 0, p.full.length);
      if (p.a.length !== c) { p.a.data = p.full.slice(0, c); p.b.textContent = p.full.slice(c); }
      left -= p.full.length;
      if (left <= 0) { i.caret = p.b; break; }
    }
    i.typed = chars;
  }
  function showText(i) {
    (i.parts || []).forEach(p => { p.a.replaceWith(p.n); p.b.remove(); });
    i.parts = null;
  }

  /* ---------- turning a layer into a cursor's job ---------- */

  function jobFor(i) {
    const base = { rect: rectOf(i), fixed: i.fixed };
    const finish = () => {
      R.edits++;
      if (Math.random() < .3) log('Agent', i.el.tagName.toLowerCase(), LABELS[Math.random() * LABELS.length | 0]);
      const left = --R.left[i.sec];
      if (left === 0 && i.sec >= 0) {
        const s = document.querySelectorAll('[data-sec]')[i.sec].getBoundingClientRect();
        hole({ x: 0, y: s.top + scrollY, w: innerWidth, h: s.height }, false, true);
      }
    };
    if (i.kind === 'shape') {
      return {
        ...base, kind: 'draw', mode: 'cross', fill: Swarm.GREY, handles: true, badge: true, spray: true, crowd: i.crowd,
        dur: (clamp(.3 + Math.sqrt(i.w * i.h) / 1100, .34, .85) + (i.crowd ? .9 : 0)) / R.pace,
        onDone(job) { hole(job.rect(), i.fixed); finish(); },
      };
    }
    if (i.kind === 'type') {
      const big = i.len < 60 && i.h > 50;
      return {
        ...base, kind: 'type', mode: 'ibeam', handles: i.w > 40, badge: Math.random() < .5, spray: i.len > 10,
        dur: clamp(i.len / (big ? 24 : 130), .2, big ? 1.8 : 1.3) / R.pace, label: LABELS[Math.random() * LABELS.length | 0],
        onStart(job) { hole(job.rect(), i.fixed); },
        onTick(p, a) {
          typeTo(i, Math.round((i.total || 0) * p));
          const c = i.caret?.getClientRects()[0];
          if (c) { a.x = c.left; a.y = c.top + scrollY + c.height / 2; }
        },
        onDone() { showText(i); finish(); },
      };
    }
    return {
      ...base, kind: 'trace', dur: .24 / R.pace, badge: Math.random() < .5, label: LABELS[Math.random() * LABELS.length | 0], spray: Math.random() < .4,
      onDone(job) { hole(job.rect(), i.fixed); finish(); },
    };
  }

  /* ---------- the run ---------- */

  function survey() {
    if (!R.scan.length) return;
    const a = swarm.nearestFree(innerWidth / 2, scrollY + innerHeight / 2);
    if (!a) return;
    const el = R.scan.pop(), r = el.getBoundingClientRect();
    if (r.width < 6 || r.height < 6) return;
    const box = { x: r.left, y: r.top + scrollY, w: r.width, h: r.height };
    swarm.assign(a, {
      rect: () => box, kind: 'trace', dur: .24, spray: Math.random() < .35,
      onDone() {
        const o = { keep: true, alpha: .4, d: .25 };
        swarm.line(box.x, box.y, box.x + box.w, box.y, o); swarm.line(box.x + box.w, box.y, box.x + box.w, box.y + box.h, o);
        swarm.line(box.x, box.y + box.h, box.x + box.w, box.y + box.h, o); swarm.line(box.x, box.y, box.x, box.y + box.h, o);
      },
    });
  }

  function swapToDesign() {
    design.disabled = false;
    root.dataset.skin = R.skin;
    pressChip(R.skin);
    swarm.veilGrid = true;
    swarm.lines = swarm.lines.filter(l => !l.keep);
    swarm.resize();
    R.queue = layers(R.scope === 'viewport');
    R.layers = R.queue.length;
    R.left = {};
    R.queue.forEach(i => {
      R.left[i.sec] = (R.left[i.sec] || 0) + 1;
      if (i.kind === 'type') hideText(i);
    });
    if (R.scope === 'viewport') {
      // Only the screen goes under the blueprint; the rest of the page just changes.
      const H = document.documentElement.scrollHeight;
      swarm.holes.push({ x: 0, y: 0, w: innerWidth, h: scrollY, a: 1 }, { x: 0, y: scrollY + innerHeight, w: innerWidth, h: H, a: 1 });
    }
    R.phase = 'build';
    R.buildStart = performance.now();
    $('hud-status').textContent = 'Rebuilding';
  }

  function release(dt) {
    const rate = R.scope === 'viewport' ? 34 : (R.t < 2 ? 5 : R.t < 9 ? 9 : 26);
    R.credit = Math.min(R.credit + dt * rate, 6);
    const reach = scrollY + innerHeight * 1.04, late = R.t > 30;
    while (R.credit >= 1 && R.next < R.queue.length) {
      const i = R.queue[R.next];
      if (R.scope === 'all' && !i.fixed && i.top > reach && !late) break;
      const a = swarm.nearestFree(i.left, i.top) || swarm.spawn(true);
      swarm.assign(a, jobFor(i));
      R.next++;
      R.credit--;
    }
  }

  function arena() {
    const H = innerHeight, y1 = scrollY + H - 8;
    const front = R.phase === 'build' && R.next < R.queue.length ? R.queue[R.next].top - 20 : scrollY + 8;
    const y0 = clamp(front, scrollY + 8, y1 - 130);
    return { x0: 0, x1: innerWidth, y0, y1 };
  }

  function frame(now) {
    if (!R) return;
    try {
      tick(now);
    } catch (err) {
      console.error(err);
      stop();
      return;
    }
    if (R) requestAnimationFrame(frame);
  }

  function tick(now) {
    const gap = (now - R.last) / 1000, dt = Math.min(.05, gap);
    R.last = now;
    R.t += dt;

    if (swarm.agents.length < R.want()) swarm.spawn(true).rest = 0;

    if (R.phase === 'hold') {
      R.clock += Math.min(.5, gap);
      if (R.clock > R.holdFor) { R.phase = 'veil'; R.clock = 0; $('hud-status').textContent = 'Scanning page…'; }
    } else if (R.phase === 'veil') {
      R.clock += Math.min(.5, gap);
      swarm.veil = VEIL * clamp(R.clock / (R.scope === 'viewport' ? .35 : .8), 0, 1);
      if (R.scope !== 'viewport') survey();
      if (R.clock > (R.scope === 'viewport' ? .4 : 2.1) && !swarm.busy()) swapToDesign();
    } else if (R.phase === 'build') {
      release(dt);
      if (R.next >= R.queue.length && !swarm.busy()) {
        R.phase = 'exit'; R.clock = 0;
        swarm.leave();
        $('hud-status').textContent = 'Done';
      }
    } else if (R.phase === 'exit') {
      R.clock += dt;
      swarm.veil = Math.max(0, VEIL - R.clock * 1.4);
      if (R.clock > 1.9) { stop(); return; }
    }

    const live = R.phase === 'build' || R.phase === 'veil';
    swarm.step(dt, live ? arena() : null);
    swarm.paint();
    $('hud-agents').textContent = swarm.agents.length;
    $('hud-edits').textContent = R.edits;
  }

  function stop() {
    if (!R) return;
    (R.queue || []).forEach(showText);
    R = null;
    swarm.clear();
    swarm.reset();
    design.disabled = false;
    root.classList.remove('running');
    hud.dataset.state = 'idle';
    startCrew();
  }

  function run(skin, scope, holdFor) {
    if (R) stop();
    A = null;
    mood('build');
    Object.assign(swarm.opts, { sketchAlpha: 1, idle: [0, .25], mesh: 96 });
    swarm.reset();
    swarm.veilColor = '18,55,232';
    swarm.resize();
    root.classList.add('running', 'swarm-on');
    R = {
      skin, scope, holdFor, phase: holdFor ? 'hold' : 'veil', clock: 0, t: 0, last: performance.now(), credit: 0, next: 0, edits: 0,
      queue: null, left: {}, pace: scope === 'viewport' ? 2.2 : 1,
      scan: [...document.querySelectorAll('h1,h2,h3,p,li,a,button,img,dd')].filter(e => e.getBoundingClientRect().top < innerHeight * 1.2).sort(() => Math.random() - .5).slice(0, 120),
      want() { return Math.min(CAP(), 50 + this.t * 16 + this.edits * 1.5); },
    };
    for (let n = 0; n < 24; n++) swarm.spawn(true);
    hud.dataset.state = 'run';
    $('hud-status').textContent = holdFor ? 'Plain HTML, untouched' : 'Scanning page…';
    requestAnimationFrame(frame);
  }

  /* ---------- the crew: agents that stay on the page ---------- */

  const feed = $('feed');
  function log(who, target, what) {
    const li = document.createElement('li');
    li.innerHTML = `<b></b> `;
    li.firstChild.textContent = who;
    li.append(`${target} → ${what}`);
    feed.prepend(li);
    while (feed.children.length > 4) feed.lastChild.remove();
  }

  function startCrew() {
    if (A || R || root.classList.contains('settled')) return;
    mood('crew');
    Object.assign(swarm.opts, { sketchAlpha: .5, idle: [.6, 2.2], mesh: 64 });
    swarm.reset();
    swarm.resize();
    root.classList.add('swarm-on');
    A = { last: performance.now(), work: .4, pool: [], poolAt: 0, demo: 2, looks: ['terminal', 'glass', 'brutal', 'slop', 'editorial'], look: 0, px: -1, py: 0, moved: -9 };
    const size = phone() ? 8 : 18;
    for (let n = 0; n < size; n++) {
      const a = swarm.spawn(true);
      a.rest = rand(0, 1);
      if (NAMES[n]) a.name = NAMES[n];
    }
    requestAnimationFrame(crew);
  }

  function refreshPool() {
    A.pool = [...document.querySelectorAll('[data-b]')].filter(e => {
      const r = e.getBoundingClientRect();
      return r.width > 30 && r.height > 12 && r.top > 70 && r.bottom < innerHeight - 10 && r.height < innerHeight * .7 && !e.closest('.nav');
    });
  }

  function inspect() {
    if (!A.pool.length) return;
    const el = A.pool[Math.random() * A.pool.length | 0], r = el.getBoundingClientRect();
    const a = swarm.nearestFree(r.left, r.top + scrollY);
    if (!a) return;
    const box = { x: r.left, y: r.top + scrollY, w: r.width, h: r.height }, what = LABELS[Math.random() * LABELS.length | 0];
    swarm.assign(a, {
      rect: () => box, kind: 'trace', dur: rand(.5, .9), badge: r.height > 20, label: what, handles: true, spray: Math.random() < .25, hold: .5,
      onDone() { log(a.name || 'Agent', el.tagName.toLowerCase(), what); },
    });
  }

  // The window in the demo section is redrafted element by element, in a loop.
  function redraftWindow() {
    const after = $('after'), r = after.getBoundingClientRect();
    if (r.bottom < 80 || r.top > innerHeight - 80) return;
    const look = A.looks[A.look++ % A.looks.length];
    $('window-style').textContent = { terminal: 'Terminal', glass: 'Soft glass', brutal: 'Brutalist', slop: 'AI slop', editorial: 'Editorial' }[look];
    const parts = [...after.querySelectorAll('[data-m]')];
    let left = parts.length;
    parts.forEach((el, n) => {
      const a = swarm.nearestFree(r.left + r.width / 2, r.top + scrollY);
      const apply = () => { el.dataset.look = look; if (--left === 0) after.dataset.look = look; };
      if (!a) return apply();
      const b = el.getBoundingClientRect();
      swarm.assign(a, {
        rect: () => { const q = el.getBoundingClientRect(); return { x: q.left, y: q.top + scrollY, w: q.width, h: q.height }; },
        kind: 'draw', mode: 'cross', dur: .45 + n * .08, fill: 'rgba(255,90,31,.16)', handles: true, badge: true, spray: true,
        onDone() { apply(); log(a.name || 'Agent', el.tagName.toLowerCase(), `style ${look}`); },
      });
    });
  }

  function crew(now) {
    if (!A || R) return;
    const dt = Math.min(.05, (now - A.last) / 1000);
    A.last = now;
    A.work -= dt;
    A.demo -= dt;
    A.poolAt -= dt;
    if (A.poolAt <= 0) { refreshPool(); A.poolAt = 1.5; }
    if (A.work <= 0) { A.work = rand(.35, .9); inspect(); }
    if (A.demo <= 0) { A.demo = 5.5; redraftWindow(); }

    // The named crew gathers around the pointer while it moves.
    const near = now - A.moved < 1400;
    swarm.agents.forEach((a, n) => {
      if (!a.name || a.job) return;
      if (near) a.crowd = { r: { x: A.px - 26, y: A.py + scrollY - 26, w: 52, h: 52 }, a: n * 1.05 };
      else if (a.crowd && !a.crowd.job) a.crowd = null;
    });

    swarm.step(dt, { x0: 0, x1: innerWidth, y0: scrollY + 70, y1: scrollY + innerHeight - 10 });
    swarm.paint();
    requestAnimationFrame(crew);
  }

  addEventListener('pointermove', e => { if (A) { A.px = e.clientX; A.py = e.clientY; A.moved = performance.now(); } }, { passive: true });

  /* ---------- small live details ---------- */

  const mark = $('giant-mark');
  addEventListener('pointermove', e => {
    if (root.classList.contains('settled') || scrollY > innerHeight) return;
    const r = mark.getBoundingClientRect(), angle = Math.atan2(e.clientY - (r.top + r.height / 2), e.clientX - (r.left + r.width / 2));
    const turn = clamp(((angle + Math.PI * .75) % (Math.PI * 2) - Math.PI) * 180 / Math.PI * .12, -14, 14);
    mark.style.transform = `rotate(${turn}deg) translate(${clamp((e.clientX - innerWidth / 2) / 70, -12, 12)}px, ${clamp((e.clientY - innerHeight / 2) / 70, -12, 12)}px)`;
  }, { passive: true });

  const SETS = [['#1237e8', '#ff5a1f', '#ffffff', '#0a0f24', '#9fb6ff'], ['#f4efe6', '#b4361e', '#1b1a17', '#d8d0c2', '#6b665c'], ['#0a0f0b', '#4ade80', '#d6f5dc', '#101812', '#7ea487'], ['#ffe100', '#000000', '#ffffff', '#ff5a1f', '#222222']];
  let set = 0;
  const shufflePalette = () => { [...$('art-palette').children].forEach((c, n) => { c.style.background = SETS[set][n]; }); set = (set + 1) % SETS.length; };
  shufflePalette();
  const blocks = [...$('art-blocks').children];
  const calmMotion = root.classList.contains('settled');
  const total = document.querySelectorAll('*').length;
  $('art-count').textContent = total.toLocaleString('en-US');
  if (!calmMotion) {
    setInterval(shufflePalette, 2600);
    setInterval(() => blocks.forEach(b => b.classList.toggle('on', Math.random() < .4)), 900);
  }

  /* ---------- controls ---------- */

  function pressChip(skin) {
    document.querySelectorAll('#chips button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.skin === skin)));
  }

  const calm = () => root.classList.contains('settled');

  $('chips').addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    if (calm()) { root.dataset.skin = b.dataset.skin; pressChip(b.dataset.skin); return; }
    run(b.dataset.skin, 'viewport', 0);
  });
  $('hud-skip').onclick = stop;
  $('hud-replay').onclick = () => {
    if (calm()) return;
    scrollTo({ top: 0, behavior: 'instant' });
    design.disabled = true;
    run(root.dataset.skin, 'all', .9);
  };

  const range = $('compare-range');
  range.addEventListener('input', () => {
    $('after').style.clipPath = `inset(0 0 0 ${range.value}%)`;
    $('seam').style.left = `${range.value}%`;
  });

  $('copy').addEventListener('click', async e => {
    try {
      await navigator.clipboard.writeText($('code').textContent);
      e.target.textContent = 'Copied';
    } catch {
      getSelection().selectAllChildren($('code'));
      e.target.textContent = 'Press ⌘C';
    }
    setTimeout(() => { e.target.textContent = 'Copy'; }, 1800);
  });

  addEventListener('resize', () => { if (R) swarm.resize(); });

  if (root.classList.contains('running')) {
    Promise.race([document.fonts.ready, new Promise(r => setTimeout(r, 1200))]).then(() => run('redraft', 'all', 1.5));
  } else if (root.classList.contains('skipped')) {
    startCrew();
  }
})();
