/* Redraft Analytics (/dashboard). Reads api/dashboard with the password in the x-dash-key header.
   The site's CSP allows no inline styles, so every size and colour below is set through the DOM
   (element.style / SVG attributes), never as a style="" attribute in markup. */
'use strict';
(() => {
  const KEY_STORE = 'redraft-dash-key'; // sessionStorage: the password is forgotten when the tab closes
  const RANGE_STORE = 'redraft-dash-days';
  const REFRESH_MS = 60 * 1000;

  // One file, so one series. The chart keeps its shape in case more downloads are added.
  const SYSTEMS = [{ key: 'extension', label: 'Redraft.zip', color: 'var(--s-mac)' }];
  const ASSET_NAMES = { extension: 'Redraft.zip' };
  const ASSET_ORDER = Object.keys(ASSET_NAMES);
  const ASSET_SHORT = { extension: 'Redraft.zip' };
  const assetShort = (k) => ASSET_SHORT[k] || k;
  const NAMES = {
    systems: { mac: 'macOS', windows: 'Windows', ios: 'iPhone / iPad', android: 'Android', linux: 'Linux', chromeos: 'ChromeOS', other: 'Other' },
    devices: { desktop: 'Desktop', mobile: 'Phone', tablet: 'Tablet' },
    places: { nav: 'Top bar', install: 'Install section', final: 'Bottom of the page', other: 'Direct link' },
    clicks: { 'restyle-page': 'Tried a style', github: 'Opened GitHub', 'copy-command': 'Copied the connect command', replay: 'Pressed Replay' },
    sources: { direct: 'Direct / unknown', x: 'X', 'hacker news': 'Hacker News', github: 'GitHub', linkedin: 'LinkedIn', reddit: 'Reddit', telegram: 'Telegram', youtube: 'YouTube', google: 'Google', search: 'Other search' },
    pages: { '/': 'Home', '/dashboard': 'Dashboard' },
  };
  const FAQ = ['Does it change the real site', 'Own brand style', 'Open source', 'API key', 'Cost', 'Rewrite text', 'Every site'];
  const GH_NOTES = {
    private: 'GitHub didn’t return download counts for this repository.',
    'token-rejected': 'GitHub rejected GITHUB_TOKEN. Check that it can read 0xCodez/redraft and hasn’t expired.',
    'rate-limited': 'GitHub’s rate limit is used up for now. Counts come back within the hour.',
    unreachable: 'GitHub didn’t answer. Counts come back on the next refresh.',
    stale: 'GitHub didn’t answer just now, so these are the last counts it gave.',
  };

  const $ = (id) => document.getElementById(id);
  const store = {
    get(k, local) { try { return (local ? localStorage : sessionStorage).getItem(k); } catch { return null; } },
    set(k, v, local) {
      try {
        const s = local ? localStorage : sessionStorage;
        if (v == null) s.removeItem(k); else s.setItem(k, v);
      } catch { /* private mode: works for this page, just isn't remembered */ }
    },
  };

  const demo = new URLSearchParams(location.search).has('demo');
  let key = store.get(KEY_STORE);
  let days = Number(store.get(RANGE_STORE, true)) || 30;
  if (![7, 30, 90].includes(days)) days = 30;
  let timer = 0;
  let last = null;

  /* ---------- formatting ---------- */
  const fmt = new Intl.NumberFormat('en-US');
  const compact = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 });
  const big = (n) => (n >= 10000 ? compact.format(n) : fmt.format(n));
  const regions = typeof Intl.DisplayNames === 'function' ? new Intl.DisplayNames(['en'], { type: 'region' }) : null;
  const dayLabel = (d, opts = { month: 'short', day: 'numeric' }) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { ...opts, timeZone: 'UTC' });
  const longDay = (d) => dayLabel(d, { weekday: 'short', month: 'short', day: 'numeric' });

  const country = (code) => {
    if (!code || code === 'XX') return 'Unknown';
    const flag = String.fromCodePoint(...[...code].map((c) => 0x1f1a5 + c.charCodeAt(0)));
    let name = code;
    try { name = regions?.of(code) || code; } catch { /* keep the code */ }
    return `${flag}  ${name}`;
  };
  const assetName = (k) => (k.startsWith('mesh:') ? `Mesh · ${ASSET_NAMES[k.slice(5)] || k.slice(5)}` : ASSET_NAMES[k] || k);
  const systemOf = (k) => k;
  const label = (group, raw) => {
    if (group === 'countries') return country(raw);
    if (group === 'platforms') return assetName(raw);
    if (group === 'clicks' && /^faq-\d+$/.test(raw)) return `FAQ: ${FAQ[Number(raw.slice(4)) - 1] || raw}`;
    return NAMES[group]?.[raw] || raw;
  };

  // Small DOM builder: text only, never HTML, so nothing from the data can inject markup.
  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };
  const swatch = (color, cls) => {
    const i = el('i', cls);
    i.style.background = color;
    return i;
  };

  /* ---------- data ---------- */
  async function load() {
    if (demo) return demoData(days);
    const res = await fetch(`/api/dashboard?days=${days}`, { headers: { 'x-dash-key': encodeURIComponent(key || '') }, cache: 'no-store' }).catch(() => null);
    if (!res) throw Object.assign(new Error('offline'), { code: 'offline' });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(body.error || 'error'), { code: body.error || (res.status === 401 ? 'unauthorized' : 'error') });
    return body;
  }

  async function refresh(manual) {
    const button = $('refresh');
    if (manual) button.classList.add('spinning');
    try {
      last = await load();
      showApp(); // first: charts are drawn at their container's size, which is 0 while hidden
      render(last);
    } catch (err) {
      if (err.code === 'unauthorized') return signOut('Wrong password.');
      if (err.code === 'no-password') return signOut('Set DASHBOARD_PASSWORD in Vercel › getredraft › Settings › Environment Variables, then redeploy.');
      if (!last) return signOut(err.code === 'storage' ? 'Couldn’t read the analytics database. Try again in a moment.' : 'Couldn’t reach the dashboard API. Try again in a moment.');
      $('footer').textContent = 'Couldn’t refresh, showing the last numbers.';
    } finally {
      button.classList.remove('spinning');
    }
    clearTimeout(timer);
    timer = setTimeout(() => refresh(false), REFRESH_MS);
  }

  /* ---------- sign in / out ---------- */
  function showApp() {
    $('login').hidden = true;
    $('app').hidden = false;
  }
  function signOut(message) {
    clearTimeout(timer);
    key = null;
    last = null;
    store.set(KEY_STORE, null);
    $('app').hidden = true;
    $('login').hidden = false;
    $('loginError').textContent = message || '';
    $('password').value = '';
    $('password').focus();
  }
  $('loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    key = $('password').value;
    $('loginError').textContent = '';
    store.set(KEY_STORE, key);
    await refresh(true);
  });
  $('signOut').addEventListener('click', () => signOut(''));
  $('refresh').addEventListener('click', () => refresh(true));

  function renderRange() {
    $('range').querySelectorAll('button').forEach((b) => {
      const on = Number(b.dataset.days) === days;
      b.setAttribute('aria-checked', String(on));
      b.tabIndex = on ? 0 : -1;
    });
  }
  $('range').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-days]');
    if (!b) return;
    days = Number(b.dataset.days);
    store.set(RANGE_STORE, String(days), true);
    renderRange();
    refresh(true);
  });
  $('range').addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    const opts = [7, 30, 90];
    days = opts[(opts.indexOf(days) + (e.key === 'ArrowRight' ? 1 : 2)) % 3];
    store.set(RANGE_STORE, String(days), true);
    renderRange();
    $('range').querySelector('[aria-checked="true"]').focus();
    refresh(true);
  });

  /* ---------- rendering ---------- */
  const bySystem = (dl) => {
    const out = { extension: 0 };
    for (const [k, v] of Object.entries(dl || {})) if (systemOf(k) in out) out[systemOf(k)] += v;
    return out;
  };

  function render(data) {
    $('storageNotice').hidden = data.storage !== 'memory' || demo;
    const conversion = data.visitors ? Math.min(100, (data.downloaders / data.visitors) * 100) : 0;
    $('kVisitors').textContent = big(data.visitors);
    $('kVisitorsSub').textContent = `unique, last ${data.days} days`;
    $('kPageviews').textContent = big(data.pageviews);
    $('kPageviewsSub').textContent = data.visitors ? `${(data.pageviews / data.visitors).toFixed(1)} per visitor` : 'no visits yet';
    $('kDownloads').textContent = big(data.downloads);
    $('kDownloadsSub').textContent = `${big(data.downloaders)} unique people`;
    $('kConversion').textContent = `${conversion.toFixed(conversion >= 10 || conversion === 0 ? 0 : 1)}%`;
    $('kOnline').textContent = fmt.format(data.online);

    const gh = data.github || {};
    if (data.releases) {
      const total = data.releases.reduce((s, r) => s + Object.values(r.assets).reduce((a, b) => a + b, 0), 0);
      $('kGithub').textContent = big(total);
      $('kGithubSub').textContent = `${data.releases.length} release${data.releases.length === 1 ? '' : 's'}, all time`;
    } else {
      $('kGithub').textContent = '—';
      $('kGithubSub').textContent = gh.status === 'private' ? 'needs GITHUB_TOKEN' : 'GitHub didn’t answer';
    }
    $('releasesNote').textContent = GH_NOTES[gh.status] || 'Downloads counted by GitHub, including people who never visited the site.';

    drawVisitors(data.series);
    drawDownloads(data.series);
    bars('platforms', data.platforms, (k) => SYSTEMS.find((s) => s.key === systemOf(k))?.color);
    bars('places', data.places);
    bars('systems', data.systems);
    bars('sources', data.sources);
    bars('countries', data.countries);
    bars('devices', data.devices);
    bars('pages', data.pages);
    bars('clicks', data.clicks);
    releasesTable(data.releases);

    const time = new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    $('footer').textContent = `Updated ${time} · refreshes every minute · cookieless, no IPs stored${data.storage === 'memory' ? ' · in-memory store' : ''}`;
  }

  function bars(id, rows, colorOf) {
    const list = $(id);
    list.replaceChildren();
    const total = (rows || []).reduce((s, [, v]) => s + v, 0);
    if (!total) {
      list.append(el('li', 'none', 'Nothing yet'));
      return;
    }
    const max = rows[0][1];
    for (const [raw, v] of rows.slice(0, 8)) {
      const li = el('li');
      li.title = `${label(id, raw)}: ${fmt.format(v)}`;
      const fill = el('span', 'fill');
      fill.style.width = `${Math.max(2, (v / max) * 100)}%`;
      const name = el('span', 'label');
      const color = colorOf && colorOf(raw);
      if (color) name.append(swatch(color, 'swatch'));
      name.append(label(id, raw));
      li.append(fill, name, el('span', 'num', big(v)), el('span', 'pct', `${Math.round((v / total) * 100)}%`));
      list.append(li);
    }
  }

  function releasesTable(releases) {
    const table = $('releasesTable');
    table.replaceChildren();
    if (!releases?.length) {
      const tr = el('tr');
      tr.append(el('td', 'muted', releases ? 'No releases yet.' : 'No counts from GitHub yet.'));
      const tbody = el('tbody');
      tbody.append(tr);
      table.append(tbody);
      return;
    }
    const seen = new Set(releases.flatMap((r) => Object.keys(r.assets)));
    const rank = (k) => {
      const base = k.replace(/^mesh:/, '');
      const i = ASSET_ORDER.indexOf(base);
      return (k.startsWith('mesh:') ? 100 : 0) + (i < 0 ? 50 : i);
    };
    const cols = [...seen].sort((a, b) => rank(a) - rank(b));
    const head = el('tr');
    head.append(el('th', null, 'Release'), el('th', null, 'Published'), ...cols.map((c) => { const th = el('th', null, assetShort(c)); th.title = assetName(c); return th; }), el('th', null, 'Total'));
    const body = el('tbody');
    for (const r of releases) {
      const tr = el('tr');
      const tag = el('td', null, r.tag);
      if (r.prerelease) tag.append(el('span', 'tag-pre', 'pre'));
      const date = r.date ? new Date(r.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—';
      const counts = cols.map((c) => r.assets[c] || 0);
      const total = el('td');
      total.append(el('b', null, fmt.format(counts.reduce((a, b) => a + b, 0))));
      tr.append(tag, el('td', null, date), ...counts.map((c) => el('td', null, fmt.format(c))), total);
      body.append(tr);
    }
    const thead = el('thead');
    thead.append(head);
    table.append(thead, body);
  }

  /* ---------- SVG charts ---------- */
  const NS = 'http://www.w3.org/2000/svg';
  const PAD = { top: 14, right: 12, bottom: 26, left: 40 };
  const svgEl = (tag, attrs, parent) => {
    const n = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
    if (parent) parent.append(n);
    return n;
  };
  // round ticks: 0, 5, 10… or 0, 200, 400…
  const niceMax = (v) => {
    if (v <= 4) return 4;
    const step = 10 ** Math.floor(Math.log10(v / 4));
    return [1, 2, 2.5, 5, 10].map((m) => m * step).find((s) => s * 4 >= v) * 4;
  };
  function frame(container, max, labelText) {
    container.replaceChildren();
    const w = container.clientWidth;
    const h = container.clientHeight;
    const svg = svgEl('svg', { viewBox: `0 0 ${w} ${h}`, role: 'img', 'aria-label': labelText }, container);
    const plot = { x: PAD.left, y: PAD.top, w: w - PAD.left - PAD.right, h: h - PAD.top - PAD.bottom };
    const yMax = niceMax(max);
    for (let i = 0; i <= 4; i++) {
      const y = plot.y + plot.h - (plot.h * i) / 4;
      svgEl('line', { class: i === 0 ? 'baseline' : 'gridline', x1: plot.x, x2: plot.x + plot.w, y1: y, y2: y }, svg);
      svgEl('text', { class: 'tick', x: plot.x - 8, y: y + 4, 'text-anchor': 'end' }, svg).textContent = compact.format((yMax * i) / 4);
    }
    return { svg, plot, y: (v) => plot.y + plot.h - (v / yMax) * plot.h };
  }
  function xLabels(svg, plot, series, xOf) {
    const narrow = plot.w < 420;
    const picks = series.length <= (narrow ? 4 : 7) ? series.map((_, i) => i) : [0, Math.floor((series.length - 1) / 2), series.length - 1];
    for (const i of picks) {
      const anchor = series.length === 1 ? 'middle' : i === 0 ? 'start' : i === series.length - 1 ? 'end' : 'middle';
      svgEl('text', { class: 'tick', x: xOf(i), y: plot.y + plot.h + 18, 'text-anchor': anchor }, svg).textContent = dayLabel(series[i].d);
    }
  }
  function ttRow(text, value, color) {
    const row = el('div', 'tt-row');
    if (color) row.append(swatch(color));
    row.append(text, el('b', null, value));
    return row;
  }
  function tooltip(nodes, x, y) {
    const tip = $('tooltip');
    if (!nodes) { tip.hidden = true; return; }
    tip.replaceChildren(...nodes);
    tip.hidden = false;
    const { width, height } = tip.getBoundingClientRect();
    const left = x + 16 + width > innerWidth ? x - width - 16 : x + 16;
    tip.style.left = `${Math.max(8, left)}px`;
    tip.style.top = `${Math.max(8, y - height - 12)}px`;
  }

  function drawVisitors(series) {
    const container = $('visitorsChart');
    const max = Math.max(0, ...series.map((r) => r.uv));
    const { svg, plot, y } = frame(container, max, 'Unique visitors per day');
    const defs = svgEl('defs', {}, svg);
    const grad = svgEl('linearGradient', { id: 'areaFill', x1: 0, x2: 0, y1: 0, y2: 1 }, defs);
    svgEl('stop', { offset: '0', 'stop-color': '#e9e9ee', 'stop-opacity': '.16' }, grad);
    svgEl('stop', { offset: '1', 'stop-color': '#e9e9ee', 'stop-opacity': '0' }, grad);
    const step = series.length > 1 ? plot.w / (series.length - 1) : 0;
    const xOf = (i) => (series.length > 1 ? plot.x + i * step : plot.x + plot.w / 2);
    const pts = series.map((r, i) => [xOf(i), y(r.uv)]);
    const line = pts.map(([px, py], i) => `${i ? 'L' : 'M'}${px.toFixed(1)} ${py.toFixed(1)}`).join('');
    svgEl('path', { class: 'area', d: `${line}L${pts.at(-1)[0]} ${y(0)}L${pts[0][0]} ${y(0)}Z` }, svg);
    svgEl('path', { class: 'line', d: line }, svg);
    if (!max) svgEl('text', { class: 'empty', x: plot.x + plot.w / 2, y: plot.y + plot.h / 2, 'text-anchor': 'middle' }, svg).textContent = 'No visitors yet in this range';
    const [ex, ey] = pts.at(-1);
    svgEl('circle', { class: 'dot', cx: ex, cy: ey, r: 4 }, svg);
    if (max) svgEl('text', { class: 'end-label', x: ex - 8, y: ey - 10, 'text-anchor': 'end' }, svg).textContent = fmt.format(series.at(-1).uv);
    xLabels(svg, plot, series, xOf);

    const cross = svgEl('line', { class: 'crosshair', y1: plot.y, y2: plot.y + plot.h, visibility: 'hidden' }, svg);
    const dot = svgEl('circle', { class: 'dot', r: 5, visibility: 'hidden' }, svg);
    const hit = svgEl('rect', { class: 'hit', x: plot.x - step / 2, y: plot.y, width: plot.w + step, height: plot.h }, svg);
    hit.addEventListener('pointermove', (e) => {
      const box = svg.getBoundingClientRect();
      const i = Math.max(0, Math.min(series.length - 1, Math.round((e.clientX - box.left - plot.x) / (step || 1))));
      const [px, py] = pts[i];
      cross.setAttribute('x1', px); cross.setAttribute('x2', px); cross.setAttribute('visibility', 'visible');
      dot.setAttribute('cx', px); dot.setAttribute('cy', py); dot.setAttribute('visibility', 'visible');
      const r = series[i];
      tooltip([el('div', 'tt-title', longDay(r.d)), ttRow('Visitors', fmt.format(r.uv)), ttRow('Page views', fmt.format(r.pv))], e.clientX, e.clientY);
    });
    hit.addEventListener('pointerleave', () => {
      cross.setAttribute('visibility', 'hidden');
      dot.setAttribute('visibility', 'hidden');
      tooltip(null);
    });

    fillTable($('visitorsTable'), ['Day', 'Visitors', 'Page views'], [...series].reverse().map((r) => [longDay(r.d), fmt.format(r.uv), fmt.format(r.pv)]));
  }

  // bar with a 4px rounded data end and a square base
  const topRounded = (x, y, w, h, r) => {
    r = Math.min(r, h, w / 2);
    return `M${x} ${y + h}V${y + r}Q${x} ${y} ${x + r} ${y}H${x + w - r}Q${x + w} ${y} ${x + w} ${y + r}V${y + h}Z`;
  };

  function drawDownloads(series) {
    const legend = $('downloadsLegend');
    legend.replaceChildren(...SYSTEMS.map((s) => { const li = el('li'); li.append(swatch(s.color), s.label); return li; }));
    const container = $('downloadsChart');
    const rows = series.map((r) => bySystem(r.dl));
    const totals = rows.map((r) => SYSTEMS.reduce((s, x) => s + r[x.key], 0));
    const max = Math.max(0, ...totals);
    const { svg, plot, y } = frame(container, max, 'Download clicks per day by system');
    const band = plot.w / series.length;
    const barW = Math.max(2, Math.min(22, band * 0.62));
    const xOf = (i) => plot.x + band * i + band / 2;
    const GAP = 2;
    series.forEach((r, i) => {
      const hover = svgEl('rect', { class: 'band-hover', x: plot.x + band * i, y: plot.y, width: band, height: plot.h, rx: 6, opacity: 0 }, svg);
      let base = y(0);
      const filled = SYSTEMS.filter((s) => rows[i][s.key]);
      filled.forEach((s, j) => {
        const h = y(0) - y(rows[i][s.key]);
        const top = base - h;
        const segH = Math.max(1, h - (j > 0 ? GAP : 0)); // 2px surface gap between stacked segments
        const x = xOf(i) - barW / 2;
        const d = j === filled.length - 1 ? topRounded(x, top, barW, segH, 4) : `M${x} ${top}h${barW}v${segH}h${-barW}Z`;
        svgEl('path', { d, fill: s.color.replace(/var\((--[\w-]+)\)/, (_, v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim()) }, svg);
        base = top;
      });
      const hit = svgEl('rect', { class: 'hit', x: plot.x + band * i, y: plot.y, width: band, height: plot.h }, svg);
      hit.addEventListener('pointermove', (e) => {
        hover.setAttribute('opacity', 1);
        tooltip([
          el('div', 'tt-title', longDay(r.d)),
          ...SYSTEMS.map((s) => ttRow(s.label, fmt.format(rows[i][s.key]), s.color)),
          ttRow('Total', fmt.format(totals[i])),
        ], e.clientX, e.clientY);
      });
      hit.addEventListener('pointerleave', () => { hover.setAttribute('opacity', 0); tooltip(null); });
    });
    if (!max) svgEl('text', { class: 'empty', x: plot.x + plot.w / 2, y: plot.y + plot.h / 2, 'text-anchor': 'middle' }, svg).textContent = 'No downloads yet in this range';
    xLabels(svg, plot, series, xOf);

    fillTable($('downloadsTable'), ['Day', ...SYSTEMS.map((s) => s.label), 'Total'],
      series.map((r, i) => [longDay(r.d), ...SYSTEMS.map((s) => fmt.format(rows[i][s.key])), fmt.format(totals[i])]).reverse());
  }

  function fillTable(table, head, rows) {
    const thead = el('thead');
    const hr = el('tr');
    hr.append(...head.map((h) => el('th', null, h)));
    thead.append(hr);
    const tbody = el('tbody');
    for (const r of rows) {
      const tr = el('tr');
      tr.append(...r.map((c) => el('td', null, c)));
      tbody.append(tr);
    }
    table.replaceChildren(thead, tbody);
  }

  // charts are drawn at their container's pixel size, so redraw when it changes
  let resizeFrame = 0;
  new ResizeObserver(() => {
    cancelAnimationFrame(resizeFrame);
    resizeFrame = requestAnimationFrame(() => {
      if (last && !$('app').hidden) { drawVisitors(last.series); drawDownloads(last.series); }
    });
  }).observe(document.body);

  /* ---------- ?demo: made-up numbers to preview the layout without the API ---------- */
  function demoData(n) {
    const series = Array.from({ length: n }, (_, i) => {
      const d = new Date(Date.now() - (n - 1 - i) * 864e5).toISOString().slice(0, 10);
      const uv = Math.round(60 + 30 * Math.sin(i / 3) + i * 3 + (i % 7 === 5 ? 50 : 0));
      const k = uv * 0.12;
      return { d, uv, pv: Math.round(uv * 1.6), dlu: Math.round(k * 1.4), dl: { extension: Math.round(k * 1.6) } };
    });
    const sum = (f) => series.reduce((s, r) => s + f(r), 0);
    const platforms = {};
    series.forEach((r) => Object.entries(r.dl).forEach(([k, v]) => { platforms[k] = (platforms[k] || 0) + v; }));
    return {
      storage: 'upstash', days: n,
      visitors: Math.round(sum((r) => r.uv) * 0.85), downloaders: Math.round(sum((r) => r.dlu) * 0.9),
      pageviews: sum((r) => r.pv), downloads: Object.values(platforms).reduce((a, b) => a + b, 0), online: 4, series,
      platforms: Object.entries(platforms).sort((a, b) => b[1] - a[1]),
      places: [['install', 220], ['final', 90], ['other', 18]],
      systems: [['windows', 520], ['mac', 330], ['android', 120], ['linux', 80], ['ios', 40]],
      sources: [['direct', 300], ['github', 180], ['reddit', 90], ['x', 60], ['google', 30]],
      countries: [['US', 240], ['DE', 96], ['RU', 80], ['GB', 61], ['IN', 40], ['XX', 9]],
      devices: [['desktop', 800], ['mobile', 210], ['tablet', 20]],
      pages: [['/', 1500]],
      clicks: [['restyle-page', 120], ['github', 60], ['copy-command', 31], ['faq-4', 17], ['replay', 9]],
      releases: [{ tag: 'v0.1.0', date: new Date().toISOString(), prerelease: false, assets: { extension: 120 } }],
      github: { status: 'ok' },
    };
  }

  /* ---------- start ---------- */
  renderRange();
  if (key || demo) refresh(false);
  else signOut('');
})();
