// Numbers for /dashboard. Locked behind DASHBOARD_PASSWORD (Vercel env var), sent in the x-dash-key header.
import { timingSafeEqual, createHash } from 'node:crypto';
import { pipeline, connected, day, sendJson, ASSETS } from './_redis.js';

const HASHES = ['pages', 'src', 'cty', 'dev', 'os', 'dl', 'dlw', 'clicks'];
const LIVE_WINDOW = 5 * 60 * 1000;
const REPO = '0xCodez/redraft';
const RELEASES_URL = `https://api.github.com/repos/${REPO}/releases?per_page=30`;
const RELEASES_TTL = 10 * 60 * 1000;

// Compare hashes so the check takes the same time whatever the guess and whatever its length.
const same = (a, b) => {
  const h = (s) => createHash('sha256').update(String(s)).digest();
  return timingSafeEqual(h(a), h(b));
};

// GitHub file name -> the same key the site counts under.
export function assetKey(name) {
  return /^redraft.*\.zip$/i.test(name) ? 'extension' : null;
}

// Downloads straight from GitHub Releases, which also count people who skip the site.
// The repo is public, so no token is needed; GITHUB_TOKEN only raises the rate limit. Cached per
// function instance: a busy dashboard stays far under GitHub's 60 requests/hour unauthenticated.
let releasesCache = { at: 0, data: null, status: 'pending' };
async function releases() {
  // A "private" answer is cached too, so a dashboard left open doesn't spend the unauthenticated quota.
  if (releasesCache.status !== 'pending' && Date.now() - releasesCache.at < RELEASES_TTL) return releasesCache;
  const token = process.env.GITHUB_TOKEN;
  try {
    const headers = { accept: 'application/vnd.github+json', 'user-agent': 'redraft-dashboard', 'x-github-api-version': '2022-11-28' };
    if (token) headers.authorization = `Bearer ${token}`;
    const res = await fetch(RELEASES_URL, { headers, signal: AbortSignal.timeout(6000) });
    if (res.status === 404 || res.status === 401 || res.status === 403) {
      // 404 is what GitHub says about a private repo to anyone who can't see it.
      const status = !token ? 'private' : res.status === 403 && res.headers.get('x-ratelimit-remaining') === '0' ? 'rate-limited' : 'token-rejected';
      return (releasesCache = { at: Date.now(), data: releasesCache.data, status: releasesCache.data ? 'stale' : status });
    }
    if (!res.ok) throw new Error(`github ${res.status}`);
    const list = await res.json();
    const data = list
      .filter((r) => !r.draft)
      .map((r) => {
        const assets = {};
        for (const a of r.assets || []) {
          const key = assetKey(a.name);
          if (key) assets[key] = (assets[key] || 0) + (a.download_count || 0);
        }
        return { tag: r.tag_name, name: r.name || r.tag_name, date: r.published_at, prerelease: Boolean(r.prerelease), assets };
      });
    releasesCache = { at: Date.now(), data, status: 'ok' };
    return releasesCache;
  } catch {
    // stale beats nothing; null data if GitHub never answered
    return { ...releasesCache, status: releasesCache.data ? 'stale' : 'unreachable' };
  }
}

export default async function handler(req, res) {
  const password = process.env.DASHBOARD_PASSWORD;
  if (!password) return sendJson(res, { error: 'no-password' }, 'no-store', 503);
  // The page sends the password URI-encoded, since a header can't carry non-Latin characters (e.g. Cyrillic).
  let given = String(req.headers['x-dash-key'] || '');
  try {
    given = decodeURIComponent(given);
  } catch {
    // not encoded: compare as sent
  }
  if (!same(given, password)) return sendJson(res, { error: 'unauthorized' }, 'no-store', 401);

  const params = new URL(req.url, 'http://x').searchParams;
  const n = Math.min(Math.max(parseInt(params.get('days'), 10) || 30, 1), 90);
  const days = Array.from({ length: n }, (_, i) => day(new Date(Date.now() - (n - 1 - i) * 864e5)));
  const now = Date.now();

  const cmds = [];
  for (const d of days) {
    cmds.push(['GET', `pv:${d}`], ['PFCOUNT', `uv:${d}`], ['PFCOUNT', `dlu:${d}`]);
    for (const h of HASHES) cmds.push(['HGETALL', `${h}:${d}`]);
  }
  cmds.push(['PFCOUNT', ...days.map((d) => `uv:${d}`)]); // unique visitors over the whole range
  cmds.push(['PFCOUNT', ...days.map((d) => `dlu:${d}`)]); // unique downloaders over the whole range
  cmds.push(['ZREMRANGEBYSCORE', 'live', 0, now - LIVE_WINDOW], ['ZCOUNT', 'live', now - LIVE_WINDOW, '+inf']);

  let out;
  let gh;
  try {
    [out, gh] = await Promise.all([pipeline(cmds), releases()]);
  } catch {
    return sendJson(res, { error: 'storage' }, 'no-store', 502);
  }

  const per = 3 + HASHES.length;
  const totals = Object.fromEntries(HASHES.map((h) => [h, {}]));
  const series = days.map((d, i) => {
    const row = out.slice(i * per, i * per + per);
    const byHash = {};
    HASHES.forEach((h, j) => {
      const flat = row[3 + j] || [];
      byHash[h] = {};
      for (let k = 0; k < flat.length; k += 2) {
        byHash[h][flat[k]] = +flat[k + 1];
        totals[h][flat[k]] = (totals[h][flat[k]] || 0) + +flat[k + 1];
      }
    });
    return { d, pv: +row[0] || 0, uv: +row[1] || 0, dlu: +row[2] || 0, dl: byHash.dl };
  });
  const tail = out.slice(days.length * per);
  const top = (o, limit = 50) =>
    Object.entries(o)
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit);

  sendJson(
    res,
    {
      storage: connected ? 'upstash' : 'memory',
      days: n,
      assets: ASSETS,
      visitors: +tail[0] || 0,
      downloaders: +tail[1] || 0,
      pageviews: series.reduce((s, r) => s + r.pv, 0),
      downloads: Object.values(totals.dl).reduce((s, v) => s + v, 0),
      online: +tail[3] || 0,
      series,
      pages: top(totals.pages),
      sources: top(totals.src),
      countries: top(totals.cty),
      devices: top(totals.dev),
      systems: top(totals.os),
      platforms: top(totals.dl),
      places: top(totals.dlw),
      clicks: top(totals.clicks),
      releases: gh.data,
      github: { repo: REPO, status: gh.status, token: Boolean(process.env.GITHUB_TOKEN) },
    },
    'no-store',
  );
}
