const crypto = require('crypto');

const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
const RESERVED = new Set(['api', 'healthz', 'readyz', 'metrics', 'index.html', 'favicon.ico']);

const randomSlug = (n = 7) => Array.from(crypto.randomBytes(n), (b) => ALPHABET[b % 62]).join('');
const isValidSlug = (s) => /^[A-Za-z0-9_-]{3,32}$/.test(s) && !RESERVED.has(s.toLowerCase());

// Hanya http/https, maks 2048 karakter, dan bukan domain layanan ini sendiri (cegah loop).
function parseUrl(raw, baseUrl) {
  try {
    if (typeof raw !== 'string' || raw.length > 2048) return null;
    const u = new URL(raw.trim());
    if (!['http:', 'https:'].includes(u.protocol)) return null;
    if (u.host === new URL(baseUrl).host) return null;
    return u.toString();
  } catch {
    return null;
  }
}

function classifyDevice(ua = '') {
  if (/bot|crawl|spider|facebookexternalhit|preview/i.test(ua)) return 'bot';
  if (/mobile|android|iphone/i.test(ua)) return 'mobile';
  return 'desktop';
}

function refererHost(r) {
  try { return r ? new URL(r).host : null; } catch { return null; }
}

module.exports = { randomSlug, isValidSlug, parseUrl, classifyDevice, refererHost };
