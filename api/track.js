// Cookieless visit and download tracking for the private dashboard (/dashboard).
// A visitor is a salted hash of IP + browser + day, so nobody can be followed across
// days and no IP or personal data is ever stored. Downloads are counted in api/download.js.
import { createHash } from 'node:crypto';
import { pipeline, readBody, day, secret } from './_redis.js';

export const BOTS = /bot|crawl|spider|slurp|preview|facebookexternalhit|embedly|vercel|lighthouse|headless|curl|wget|python|node-fetch/i;
const TTL = 60 * 60 * 24 * 400; // keep about 13 months
const KEY = /^[a-z0-9:_-]{1,40}$/;

function source(ref, utm) {
  if (utm) return utm.toLowerCase().replace(/[^a-z0-9 ._-]/g, '').slice(0, 30) || 'direct';
  if (!ref) return 'direct';
  let host;
  try {
    host = new URL(ref).hostname.replace(/^www\./, '');
  } catch {
    return 'direct';
  }
  if (/(^|\.)getredraft\.vercel\.app$|^getredraft[a-z0-9-]*\.vercel\.app$|^localhost$|^127\.0\.0\.1$/.test(host)) return null; // moving around the site
  if (/^(t\.co|x\.com|twitter\.com)$/.test(host)) return 'x';
  if (/(^|\.)t\.me$|telegram/.test(host)) return 'telegram';
  if (/linkedin\.com$|lnkd\.in$/.test(host)) return 'linkedin';
  if (/(^|\.)reddit\.com$/.test(host)) return 'reddit';
  if (/news\.ycombinator\.com$/.test(host)) return 'hacker news';
  if (/(^|\.)github\.com$/.test(host)) return 'github';
  if (/(^|\.)youtube\.com$|youtu\.be$/.test(host)) return 'youtube';
  if (/producthunt\.com$/.test(host)) return 'product hunt';
  if (/(^|\.)google\./.test(host)) return 'google';
  if (/bing\.com$|duckduckgo\.com$|yandex\.|search\./.test(host)) return 'search';
  return host.slice(0, 40);
}

const device = (ua) => (/iPad|Tablet/i.test(ua) ? 'tablet' : /Mobi|Android|iPhone/i.test(ua) ? 'mobile' : 'desktop');

// Which system the visitor is on: Redraft's bridge needs macOS or Linux.
function system(ua) {
  if (/iPhone|iPad|iPod/i.test(ua)) return 'ios';
  if (/Android/i.test(ua)) return 'android';
  if (/Mac OS X|Macintosh/i.test(ua)) return 'mac';
  if (/Windows/i.test(ua)) return 'windows';
  if (/CrOS/i.test(ua)) return 'chromeos';
  if (/Linux/i.test(ua)) return 'linux';
  return 'other';
}

export default async function handler(req, res) {
  res.setHeader('cache-control', 'no-store');
  if (req.method !== 'POST') {
    res.statusCode = 405;
    return res.end();
  }
  const ua = String(req.headers['user-agent'] || '');
  if (!ua || BOTS.test(ua)) {
    res.statusCode = 204;
    return res.end();
  }

  let data;
  try {
    data = JSON.parse(await readBody(req));
  } catch {
    res.statusCode = 400;
    return res.end();
  }
  if (!data || typeof data !== 'object') {
    res.statusCode = 400;
    return res.end();
  }

  const d = day();
  const ip = String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '').split(',')[0].trim();
  const id = createHash('sha256').update(`${secret}|${ip}|${ua}|${d}`).digest('hex').slice(0, 16);
  const exp = (k) => ['EXPIRE', k, TTL];

  try {
    if (data.t === 'pv') {
      // only plain path characters, so a hand-made request can't store markup or long junk
      const path = String(data.p || '/').split(/[?#]/)[0].replace(/[^A-Za-z0-9/._~-]/g, '').slice(0, 60) || '/';
      const src = source(String(data.r || ''), data.u ? String(data.u) : '');
      const [, isNew] = await pipeline([
        ['INCR', `pv:${d}`],
        ['PFADD', `uv:${d}`, id],
        ['HINCRBY', `pages:${d}`, path, 1],
        ['ZADD', 'live', Date.now(), id],
        exp(`pv:${d}`),
        exp(`uv:${d}`),
        exp(`pages:${d}`),
      ]);
      const more = [];
      if (src) more.push(['HINCRBY', `src:${d}`, src, 1], exp(`src:${d}`));
      // country, device and system are counted once per visitor per day
      if (isNew) {
        const country = String(req.headers['x-vercel-ip-country'] || 'XX').slice(0, 2).toUpperCase();
        more.push(
          ['HINCRBY', `cty:${d}`, /^[A-Z]{2}$/.test(country) ? country : 'XX', 1],
          ['HINCRBY', `dev:${d}`, device(ua), 1],
          ['HINCRBY', `os:${d}`, system(ua), 1],
          exp(`cty:${d}`),
          exp(`dev:${d}`),
          exp(`os:${d}`),
        );
      }
      await pipeline(more);
    } else if (data.t === 'click' && KEY.test(data.k || '')) {
      await pipeline([['HINCRBY', `clicks:${d}`, data.k, 1], ['ZADD', 'live', Date.now(), id], exp(`clicks:${d}`)]);
    }
  } catch {
    // analytics must never break the site
  }
  res.statusCode = 204;
  res.end();
}
