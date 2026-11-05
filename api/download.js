// GET /api/download?from=hero|install|final
// Counts the download on the server, then hands over the file, so the number stays right
// for visitors with blockers or without JavaScript. Same cookieless visitor hash as api/track.js.
import { createHash } from 'node:crypto';
import { pipeline, day, secret } from './_redis.js';
import { BOTS } from './track.js';

const TTL = 60 * 60 * 24 * 400;
const PLACES = new Set(['nav', 'install', 'final']);

export default async function handler(req, res) {
  const ua = String(req.headers['user-agent'] || '');
  if (ua && !BOTS.test(ua)) {
    const d = day();
    const from = new URL(req.url, 'http://x').searchParams.get('from');
    const place = PLACES.has(from) ? from : 'other';
    const ip = String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '').split(',')[0].trim();
    const id = createHash('sha256').update(`${secret}|${ip}|${ua}|${d}`).digest('hex').slice(0, 16);
    const exp = (k) => ['EXPIRE', k, TTL];
    try {
      await pipeline([
        ['HINCRBY', `dl:${d}`, 'extension', 1],
        ['HINCRBY', `dlw:${d}`, place, 1],
        ['PFADD', `dlu:${d}`, id],
        ['ZADD', 'live', Date.now(), id],
        exp(`dl:${d}`),
        exp(`dlw:${d}`),
        exp(`dlu:${d}`),
      ]);
    } catch {
      // the download must work even when analytics doesn't
    }
  }
  res.statusCode = 302;
  res.setHeader('location', '/redraft.zip');
  res.setHeader('cache-control', 'no-store');
  res.end();
}
