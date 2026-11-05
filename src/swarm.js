// Cursor swarm engine. Agents take jobs, draw boxes and leave construction lines on one
// canvas overlay. It knows nothing about what a job means: callers hand it a rect and
// callbacks, so the same engine plays the page reveal and the live browser redesign.
//
// A job: { rect() -> {x, y, w, h}, fixed, kind, mode, dur, stroke, fill, badge, handles,
//          spray, crowd, onStart(job, agent), onTick(p, agent, job), onDone(job, agent) }
// kind: 'draw' drag a rectangle | 'line' drag a vertical line | 'trace' walk the outline |
//       'type' stand still while onTick moves the agent | 'stamp' a short flash
class Swarm {
  static COLORS = ['#67e8f9', '#86efac', '#fdba74', '#fde047', '#a78bfa', '#f9a8d4', '#fca5a5', '#5eead4'];
  // Selection colour, line colour and shape fill are themeable before the first frame.
  static BLUE = '#2f80ed';
  static LINE = '#7dbbff';
  static RED = '#ef4444';
  static AMBER = '#f59e0b';
  static GREY = 'rgba(152,154,148,.72)';

  constructor(canvas, opts = {}) {
    this.cv = canvas;
    this.ctx = canvas.getContext('2d');
    this.opts = { trail: 26, maxLines: 1300, mesh: 96, sketch: true, ...opts };
    this.reset();
  }

  reset() {
    this.agents = [];
    this.boxes = [];
    this.lines = [];
    this.holes = [];
    this.veil = 0;
    this.veilColor = '9,10,14';
    this.veilGrid = false;
    this.clock = 0;
    this.leaving = false;
  }

  resize() {
    const dpr = Math.min(devicePixelRatio || 1, 2);
    this.dpr = dpr;
    this.cv.width = innerWidth * dpr;
    this.cv.height = innerHeight * dpr;
  }

  /* ---------- agents ---------- */

  spawn(atEdge = true) {
    const n = this.agents.length;
    const a = {
      color: Swarm.COLORS[n % Swarm.COLORS.length], mode: 'arrow', x: 0, y: 0, trail: [],
      fly: null, job: null, crowd: null, rest: rand(0, .6), group: n % 5, angle: rand(-.3, .3), radius: rand(70, 150),
    };
    if (atEdge) {
      a.x = rand(0, innerWidth);
      a.y = scrollY + (Math.random() < .5 ? -30 : innerHeight + 30);
    }
    this.agents.push(a);
    return a;
  }

  // Circle a point on screen, used while a page is being scanned.
  orbit(cx, cy) {
    for (const a of this.agents) {
      const ang = a.group * 1.257 + a.angle + this.clock * 1.25;
      a.x = cx + Math.cos(ang) * a.radius;
      a.y = scrollY + cy + Math.sin(ang) * a.radius * .92;
    }
  }

  nearestFree(x, y) {
    let best = null, d = Infinity;
    for (const a of this.agents) {
      if (a.job || a.crowd) continue;
      const k = Math.abs(a.x - x) + Math.abs(a.y - y);
      if (k < d) { d = k; best = a; }
    }
    return best;
  }

  busy() { return this.agents.some(a => a.job); }

  assign(a, job) {
    a.job = job;
    a.crowd = null;
    a.mode = job.mode || 'arrow';
    job.t = 0;
    job.started = false;
    const r = job.rect();
    this.flyTo(a, r.x, r.y + (job.fixed ? scrollY : 0), job.fly);
  }

  flyTo(a, x, y, d, straight) {
    const dx = x - a.x, dy = y - a.y, dist = Math.hypot(dx, dy) || 1;
    const bend = straight ? 0 : Math.min(70, dist * .18) * (Math.random() < .5 ? -1 : 1);
    a.fly = {
      x0: a.x, y0: a.y, x1: x, y1: y, t: 0, d: d ?? clamp(dist / 1500, .1, .55),
      cx: (a.x + x) / 2 - dy / dist * bend, cy: (a.y + y) / 2 + dx / dist * bend,
    };
  }

  begin(a) {
    const job = a.job, r = job.rect();
    job.started = true;
    job.r = r;
    const box = { x: r.x, y: r.y, w: r.w, h: r.h, fixed: job.fixed, alpha: 1, stroke: job.stroke || Swarm.BLUE, fill: job.fill, handles: job.handles, badge: job.badge, label: job.label };
    if (job.kind === 'draw') { box.grow = true; box.w = box.h = 0; }
    if (job.kind === 'line') { box.line = true; box.h = 0; }
    if (job.kind === 'trace') box.trace = 0;
    job.box = box;
    this.boxes.push(box);
    if (job.spray) this.spray(r, job.fixed, a.color);
    if (job.crowd) {
      this.agents.filter(o => !o.job && !o.crowd).slice(0, job.crowd).forEach((o, n) => {
        o.crowd = { job, r, a: n / job.crowd * Math.PI * 2 };
        o.mode = 'cross';
      });
    }
    job.onStart?.(job, a);
  }

  advance(a, dt) {
    const job = a.job, r = job.r, box = job.box;
    job.t += dt;
    const p = clamp(job.t / job.dur, 0, 1), e = ease(p), sy = job.fixed ? scrollY : 0;
    if (job.kind === 'draw') {
      box.w = r.w * e; box.h = r.h * e;
      a.x = r.x + box.w; a.y = r.y + box.h + sy;
    } else if (job.kind === 'line') {
      box.h = r.h * e;
      a.x = r.x; a.y = r.y + box.h;
    } else if (job.kind === 'trace') {
      box.trace = e;
      const [px, py] = perimeter(r, e);
      a.x = px; a.y = py + sy;
    }
    job.onTick?.(p, a, job);
    if (p >= 1) this.finish(a);
  }

  finish(a) {
    const job = a.job;
    a.job = null;
    job.box.trace = undefined;
    job.box.fading = true;
    if (job.hold) job.box.hold = job.hold;
    for (const o of this.agents) if (o.crowd?.job === job) { o.crowd = null; o.mode = 'arrow'; }
    job.onDone?.(job, a);
  }

  /* ---------- lines ---------- */

  line(x0, y0, x1, y1, o = {}) {
    if (this.lines.length >= this.opts.maxLines) this.lines.shift();
    this.lines.push({ x0, y0, x1, y1, t: 0, d: o.d ?? .5, life: o.life ?? 1.6, color: o.color || Swarm.LINE, alpha: o.alpha ?? .4, fixed: o.fixed, keep: o.keep, dash: o.dash, tip: o.tip });
  }

  // Extension lines running from an element's edges towards the viewport edges.
  spray(r, fixed, color) {
    const W = innerWidth, H = innerHeight, top = fixed ? 0 : scrollY;
    const keep = Math.random() < .3;
    const o = { color, fixed, d: rand(.25, .55), life: rand(.7, 1.7), alpha: rand(.26, .5) };
    const lines = [
      [r.x, r.y, 0, r.y], [r.x + r.w, r.y, W, r.y],
      [r.x, r.y + r.h, 0, r.y + r.h], [r.x + r.w, r.y + r.h, W, r.y + r.h],
      [r.x, r.y, r.x, top], [r.x + r.w, r.y, r.x + r.w, top],
      [r.x, r.y + r.h, r.x, top + H], [r.x + r.w, r.y + r.h, r.x + r.w, top + H],
    ];
    for (const l of lines) {
      if (Math.random() < .62) this.line(...l, o);
      if (keep && Math.random() < .5) this.line(...l, { fixed, keep: true, alpha: .1, d: .6, dash: true });
    }
    this.line(r.x - 12, r.y - 7, r.x + r.w + 12, r.y - 7, { fixed, color, alpha: .55, d: .3, life: .8, tip: true });
  }

  // Idle agents never hover: they keep ruling straight lines across their part of the page.
  sketch(a, arena) {
    const across = Math.random() < .5;
    const reach = rand(90, 460) * (Math.random() < .5 ? -1 : 1);
    const x1 = across ? clamp(a.x + reach, arena.x0, arena.x1) : a.x;
    const y1 = across ? a.y : clamp(a.y + reach, arena.y0, arena.y1);
    const d = rand(.28, .75);
    a.mode = Math.random() < .3 ? 'cross' : 'arrow';
    this.flyTo(a, x1, y1, d, true);
    a.fly.steady = true;
    this.line(a.x, a.y, x1, y1, { color: a.color, d, alpha: rand(.2, .45), life: rand(.8, 2.2), tip: true });
  }

  /* ---------- simulation ---------- */

  step(dt, arena) {
    this.clock += dt;
    for (const a of this.agents) this.move(a, dt, arena);
    for (const l of this.lines) l.t += dt;
    if (this.leaving) for (const l of this.lines) l.keep = false;
    this.lines = this.lines.filter(l => l.keep || l.t < l.d + l.life);
    this.boxes = this.boxes.filter(b => {
      if (!b.fading) return true;
      if (b.hold > 0) { b.hold -= dt; return true; }
      b.alpha -= dt / .26;
      return b.alpha > 0;
    });
  }

  move(a, dt, arena) {
    if (a.exit) {
      a.exit.delay -= dt;
      if (a.exit.delay <= 0 && !a.gone) { this.flyTo(a, a.exit.x, a.exit.y, a.exit.d); a.gone = true; }
    }
    if (a.fly) {
      const f = a.fly;
      f.t += dt / f.d;
      const u = clamp(f.t, 0, 1), p = f.steady ? u : ease(u), q = 1 - p;
      a.x = q * q * f.x0 + 2 * q * p * f.cx + p * p * f.x1;
      a.y = q * q * f.y0 + 2 * q * p * f.cy + p * p * f.y1;
      if (f.t >= 1) a.fly = null;
    } else if (a.job) {
      if (!a.job.started) this.begin(a);
      this.advance(a, dt);
    } else if (a.crowd) {
      const { r, a: ang } = a.crowd, turn = ang + this.clock * .9;
      a.x += (r.x + r.w / 2 + Math.cos(turn) * (r.w / 2 + 16) - a.x) * .12;
      a.y += (r.y + r.h / 2 + Math.sin(turn) * (r.h / 2 + 16) - a.y) * .12;
    } else if (arena && !a.exit && this.opts.sketch) {
      a.rest -= dt;
      if (a.rest <= 0) { a.rest = rand(0, .25); this.sketch(a, arena); }
    }
  }

  leave() {
    this.leaving = true;
    for (const a of this.agents) {
      a.crowd = null;
      a.fly = null;
      a.exit = { delay: rand(0, .8), d: rand(.7, 1.1), x: rand(innerWidth * .62, innerWidth + 60), y: scrollY + innerHeight + 60 };
    }
  }

  /* ---------- drawing ---------- */

  clear() {
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.clearRect(0, 0, this.cv.width, this.cv.height);
  }

  paint(under) {
    const { ctx, dpr } = this, sy = scrollY;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    if (this.veil > 0) this.paintVeil(sy);
    under?.(ctx);
    this.paintLines(sy);
    for (const b of this.boxes) this.drawBox(b, sy);
    this.paintMesh(sy);
    for (const a of this.agents) this.drawAgent(a, sy);
    ctx.globalAlpha = 1;
  }

  // A dark sheet over the page; `holes` are the parts the swarm has finished.
  paintVeil(sy) {
    const { ctx } = this;
    ctx.fillStyle = `rgba(${this.veilColor},${this.veil})`;
    ctx.fillRect(0, 0, innerWidth, innerHeight);
    if (this.veilGrid) this.paintGrid(sy);
    ctx.globalCompositeOperation = 'destination-out';
    for (const h of this.holes) {
      h.a = Math.min(1, h.a + .07);
      ctx.fillStyle = `rgba(0,0,0,${h.a})`;
      ctx.fillRect(h.x, h.fixed ? h.y : h.y - sy, h.w, h.h);
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  // Blueprint paper: a fine grid with a heavier line every fifth cell, fixed to the page.
  paintGrid(sy) {
    const { ctx } = this, S = 32, W = innerWidth, H = innerHeight;
    for (const [every, alpha] of [[1, .09], [5, .2]]) {
      const step = S * every;
      ctx.strokeStyle = `rgba(255,255,255,${alpha * this.veil})`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let x = 0; x < W; x += step) { ctx.moveTo(x + .5, 0); ctx.lineTo(x + .5, H); }
      for (let y = -(sy % step); y < H; y += step) { ctx.moveTo(0, y + .5); ctx.lineTo(W, y + .5); }
      ctx.stroke();
    }
  }

  paintLines(sy) {
    const { ctx } = this;
    ctx.lineWidth = 1;
    for (const l of this.lines) {
      const p = ease(clamp(l.t / l.d, 0, 1));
      const fade = l.keep ? 1 : clamp((l.d + l.life - l.t) / (l.life * .5), 0, 1);
      const off = l.fixed ? 0 : sy;
      const x = l.x0 + (l.x1 - l.x0) * p, y = l.y0 + (l.y1 - l.y0) * p - off;
      ctx.globalAlpha = l.alpha * fade;
      ctx.strokeStyle = l.color;
      ctx.setLineDash(l.dash ? [3, 5] : []);
      ctx.beginPath();
      ctx.moveTo(l.x0 + .5, l.y0 - off + .5);
      ctx.lineTo(x + .5, y + .5);
      ctx.stroke();
      if (l.tip) {
        ctx.fillStyle = l.color;
        ctx.fillRect(l.x0 - 1.5, l.y0 - off - 1.5, 3, 3);
        ctx.fillRect(x - 1.5, y - 1.5, 3, 3);
      }
    }
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
  }

  // Thin links between cursors working close together.
  paintMesh(sy) {
    const { ctx, agents } = this, R = this.opts.mesh, R2 = R * R, cells = new Map();
    const key = (x, y) => (x + 500) * 4096 + y;
    agents.forEach(a => {
      const y = a.y - sy;
      if (y < -R || y > innerHeight + R) return;
      const k = key(a.x / R | 0, y / R | 0);
      if (!cells.has(k)) cells.set(k, []);
      cells.get(k).push(a);
    });
    let links = 0;
    ctx.lineWidth = .6;
    for (const a of agents) {
      const y = a.y - sy, cx = a.x / R | 0, cy = y / R | 0;
      for (let i = 0; i <= 1; i++) for (let j = -1; j <= 1; j++) {
        for (const b of cells.get(key(cx + i, cy + j)) || []) {
          if (b === a || links > 420) continue;
          if (i === 0 && j <= 0 && b.x <= a.x) continue;
          const d = (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
          if (d > R2) continue;
          ctx.globalAlpha = .28 * (1 - d / R2);
          ctx.strokeStyle = a.color;
          ctx.beginPath(); ctx.moveTo(a.x, y); ctx.lineTo(b.x, b.y - sy); ctx.stroke();
          links++;
        }
      }
    }
    ctx.globalAlpha = 1;
  }

  drawBox(b, sy) {
    const { ctx } = this, y = b.fixed ? b.y : b.y - sy;
    if (y > innerHeight + 40 || y + b.h < -40) return;
    ctx.globalAlpha = clamp(b.alpha, 0, 1);
    if (b.line) {
      ctx.fillStyle = Swarm.LINE; ctx.fillRect(b.x, y, 1, b.h);
      this.dot(b.x, y); this.dot(b.x, y + b.h);
      return;
    }
    if (b.fill) { ctx.fillStyle = b.fill; ctx.fillRect(b.x, y, b.w, b.h); }
    ctx.strokeStyle = b.stroke;
    ctx.lineWidth = 1;
    const X = Math.round(b.x) + .5, Y = Math.round(y) + .5, W = Math.round(b.w), H = Math.round(b.h);
    if (b.trace != null) {
      const stops = [[X, Y], [X + W, Y], [X + W, Y + H], [X, Y + H], [X, Y]], total = 2 * (W + H) || 1;
      let left = b.trace * total;
      ctx.beginPath();
      ctx.moveTo(X, Y);
      for (let n = 1; n < 5 && left > 0; n++) {
        const [x0, y0] = stops[n - 1], [x1, y1] = stops[n], len = Math.abs(x1 - x0) + Math.abs(y1 - y0);
        const u = Math.min(1, left / (len || 1));
        ctx.lineTo(x0 + (x1 - x0) * u, y0 + (y1 - y0) * u);
        left -= len;
      }
      ctx.stroke();
    } else ctx.strokeRect(X, Y, W, H);
    if (b.handles) { this.dot(b.x, y); this.dot(b.x + b.w, y); this.dot(b.x, y + b.h); this.dot(b.x + b.w, y + b.h); }
    if (b.badge && b.w > 12) this.tag(b.label || `${Math.round(b.w)} × ${Math.round(b.h)}`, b.x + b.w / 2, y + b.h + 5);
  }

  dot(x, y) {
    const { ctx } = this;
    ctx.fillStyle = '#fff';
    ctx.fillRect(Math.round(x) - 2, Math.round(y) - 2, 5, 5);
    ctx.strokeStyle = Swarm.BLUE;
    ctx.lineWidth = 1;
    ctx.strokeRect(Math.round(x) - 1.5, Math.round(y) - 1.5, 4, 4);
  }

  tag(s, cx, y) {
    const { ctx } = this;
    ctx.font = '600 9.5px "JetBrains Mono", ui-monospace, Menlo, monospace';
    const w = ctx.measureText(s).width + 10, x = clamp(cx - w / 2, 2, Math.max(2, innerWidth - w - 2));
    ctx.fillStyle = Swarm.BLUE;
    ctx.beginPath(); ctx.roundRect(x, y, w, 15, 3); ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.fillText(s, x + 5, y + 11);
  }

  drawAgent(a, sy) {
    const { ctx } = this, x = a.x, y = a.y - sy;
    a.trail.push(x, a.y);
    if (a.trail.length > this.opts.trail * 2) a.trail.splice(0, 2);
    if (y < -60 || y > innerHeight + 60) return;

    // The trail fades in three steps, cheaper than one stroke per segment.
    const T = a.trail, n = T.length / 2, cut = [0, n / 3 | 0, 2 * n / 3 | 0, n - 1];
    ctx.strokeStyle = a.color;
    ctx.lineCap = 'round';
    for (let s = 0; s < 3; s++) {
      if (cut[s + 1] <= cut[s]) continue;
      ctx.globalAlpha = [.08, .2, .42][s];
      ctx.lineWidth = [.6, 1, 1.5][s];
      ctx.beginPath();
      ctx.moveTo(T[cut[s] * 2], T[cut[s] * 2 + 1] - sy);
      for (let i = cut[s] + 1; i <= cut[s + 1]; i++) ctx.lineTo(T[i * 2], T[i * 2 + 1] - sy);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    if (a.mode === 'cross') {
      ctx.fillStyle = a.color;
      ctx.fillRect(x - 6, y - 1, 12, 2.4);
      ctx.fillRect(x - 1, y - 6, 2.4, 12);
    } else if (a.mode === 'ibeam') {
      ctx.strokeStyle = '#f5f5f4';
      ctx.lineWidth = 1.3;
      ctx.beginPath();
      ctx.moveTo(x, y - 6); ctx.lineTo(x, y + 6);
      ctx.moveTo(x - 2.5, y - 7); ctx.lineTo(x + 2.5, y - 7);
      ctx.moveTo(x - 2.5, y + 7); ctx.lineTo(x + 2.5, y + 7);
      ctx.stroke();
    } else {
      ctx.fillStyle = a.color;
      ctx.strokeStyle = 'rgba(0,0,0,.45)';
      ctx.lineWidth = .7;
      ctx.beginPath();
      ctx.moveTo(x, y); ctx.lineTo(x + 3.8, y + 14.5); ctx.lineTo(x + 6.4, y + 8.2); ctx.lineTo(x + 13, y + 5.6);
      ctx.closePath(); ctx.fill(); ctx.stroke();
    }
  }
}

function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
function rand(a, b) { return a + Math.random() * (b - a); }
function ease(t) { return t * t * (3 - 2 * t); }

function perimeter(r, p) {
  const total = 2 * (r.w + r.h) || 1;
  let d = p * total;
  if (d < r.w) return [r.x + d, r.y];
  d -= r.w;
  if (d < r.h) return [r.x + r.w, r.y + d];
  d -= r.h;
  if (d < r.w) return [r.x + r.w - d, r.y + r.h];
  d -= r.w;
  return [r.x, r.y + r.h - d];
}

if (typeof globalThis !== 'undefined') globalThis.Swarm = Swarm;
