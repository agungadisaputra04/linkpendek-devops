const path = require('path');
const express = require('express');
const client = require('prom-client');
const { config, pool, redis, log } = require('./common');
const { randomSlug, isValidSlug, parseUrl } = require('./util');

client.collectDefaultMetrics();
const httpDuration = new client.Histogram({
  name: 'http_request_duration_seconds', help: 'Latensi HTTP',
  labelNames: ['method', 'route', 'status'],
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5],
});
const cacheOps = new client.Counter({ name: 'redirect_cache_total', help: 'Lookup cache redirect', labelNames: ['result'] });
const linksCreated = new client.Counter({ name: 'links_created_total', help: 'Link dibuat' });
const rateLimited = new client.Counter({ name: 'rate_limited_total', help: 'Request ditolak rate limit' });
new client.Gauge({
  name: 'click_queue_length', help: 'Event klik menunggu diproses worker',
  async collect() { this.set(await redis.llen('clicks')); },
});

const app = express();
app.set('trust proxy', true); // berjalan di belakang Cloudflare / ingress
app.use(express.json({ limit: '10kb' }));
app.use((req, res, next) => {
  const end = httpDuration.startTimer();
  res.on('finish', () => end({ method: req.method, route: req.route ? req.route.path : 'other', status: res.statusCode }));
  next();
});
app.use(express.static(path.join(__dirname, '..', 'public')));

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// --- health & metrics ---
app.get('/healthz', (req, res) => res.json({ status: 'ok' }));
app.get('/readyz', wrap(async (req, res) => {
  try {
    await Promise.all([pool.query('SELECT 1'), redis.ping()]);
    res.json({ status: 'ready' });
  } catch (e) {
    res.status(503).json({ status: 'not_ready', error: e.message });
  }
}));
app.get('/metrics', wrap(async (req, res) => {
  res.set('Content-Type', client.register.contentType);
  res.end(await client.register.metrics());
}));

// --- API ---
const rateLimit = wrap(async (req, res, next) => {
  const ip = req.headers['cf-connecting-ip'] || req.ip;
  const key = `rl:${ip}`;
  const n = await redis.incr(key);
  if (n === 1) await redis.expire(key, 60);
  if (n > config.rateLimitPerMin) {
    rateLimited.inc();
    return res.status(429).json({ error: 'Terlalu banyak permintaan. Coba lagi sebentar.' });
  }
  next();
});

app.post('/api/links', rateLimit, wrap(async (req, res) => {
  const { url, slug, ttl_days: ttlDays } = req.body || {};
  const target = parseUrl(url, config.baseUrl);
  if (!target) return res.status(400).json({ error: 'URL tidak valid. Gunakan http/https dan bukan domain ini.' });
  const custom = slug ? String(slug) : null;
  if (custom && !isValidSlug(custom)) return res.status(400).json({ error: 'Slug tidak valid atau dicadangkan (3-32 karakter: huruf, angka, - dan _).' });
  let ttl = null;
  if (ttlDays != null && ttlDays !== '') {
    ttl = Number(ttlDays);
    if (!Number.isInteger(ttl) || ttl < 1 || ttl > 365) return res.status(400).json({ error: 'Masa aktif harus 1-365 hari.' });
  }
  for (let i = 0; i < 5; i++) {
    const s = custom || randomSlug();
    const { rows } = await pool.query(
      `INSERT INTO links (slug, target_url, expires_at)
       VALUES ($1, $2, CASE WHEN $3::int IS NULL THEN NULL ELSE now() + make_interval(days => $3::int) END)
       ON CONFLICT (slug) DO NOTHING
       RETURNING id, slug, target_url, created_at, expires_at`, [s, target, ttl]);
    if (rows[0]) {
      linksCreated.inc();
      return res.status(201).json({ ...rows[0], short_url: `${config.baseUrl}/${rows[0].slug}` });
    }
    if (custom) return res.status(409).json({ error: 'Slug sudah dipakai. Pilih yang lain.' });
  }
  res.status(503).json({ error: 'Gagal membuat slug. Coba lagi.' });
}));

app.get('/api/links/:slug/stats', wrap(async (req, res) => {
  const { rows: [link] } = await pool.query(
    'SELECT id, slug, target_url, created_at, expires_at FROM links WHERE slug = $1', [req.params.slug]);
  if (!link) return res.status(404).json({ error: 'Link tidak ditemukan.' });
  const id = link.id;
  const [total, daily, refs, devices] = await Promise.all([
    pool.query('SELECT count(*)::int AS n FROM click_events WHERE link_id = $1', [id]),
    pool.query(
      `SELECT to_char(d::date, 'YYYY-MM-DD') AS day, COALESCE(c.n, 0)::int AS clicks
       FROM generate_series(current_date - 6, current_date, '1 day') d
       LEFT JOIN (SELECT ts::date AS day, count(*) AS n FROM click_events
                  WHERE link_id = $1 AND ts >= current_date - 6 GROUP BY 1) c ON c.day = d::date
       ORDER BY d`, [id]),
    pool.query(
      `SELECT COALESCE(referrer, '(langsung)') AS referrer, count(*)::int AS clicks
       FROM click_events WHERE link_id = $1 GROUP BY 1 ORDER BY 2 DESC LIMIT 5`, [id]),
    pool.query(
      `SELECT device, count(*)::int AS clicks FROM click_events
       WHERE link_id = $1 GROUP BY 1 ORDER BY 2 DESC`, [id]),
  ]);
  res.json({ ...link, total_clicks: total.rows[0].n, daily: daily.rows, top_referrers: refs.rows, devices: devices.rows });
}));

app.get('/api/stats/summary', wrap(async (req, res) => {
  const cached = await redis.get('summary');
  if (cached) return res.json(JSON.parse(cached));
  const [l, c] = await Promise.all([
    pool.query('SELECT count(*)::int AS n FROM links'),
    pool.query('SELECT count(*)::int AS n FROM click_events'),
  ]);
  const s = { links: l.rows[0].n, clicks: c.rows[0].n };
  await redis.set('summary', JSON.stringify(s), 'EX', 30);
  res.json(s);
}));

// --- redirect (jalur panas) ---
app.get('/:slug', wrap(async (req, res) => {
  const { slug } = req.params;
  let link = null;
  const cached = await redis.get(`link:${slug}`);
  if (cached) {
    cacheOps.inc({ result: 'hit' });
    link = JSON.parse(cached);
  } else {
    cacheOps.inc({ result: 'miss' });
    const { rows } = await pool.query(
      'SELECT id, target_url, expires_at FROM links WHERE slug = $1 AND is_active', [slug]);
    if (rows[0]) {
      const exp = rows[0].expires_at ? new Date(rows[0].expires_at).getTime() : null;
      link = { id: rows[0].id, url: rows[0].target_url, exp };
      const ttl = Math.min(exp ? Math.floor((exp - Date.now()) / 1000) : 86400, 86400);
      if (ttl > 0) await redis.set(`link:${slug}`, JSON.stringify(link), 'EX', ttl);
    }
  }
  if (!link || (link.exp && link.exp <= Date.now())) {
    return res.status(404).type('text').send('Link tidak ditemukan atau sudah kedaluwarsa.');
  }
  // Catat klik secara asinkron; kegagalan Redis tidak boleh menggagalkan redirect.
  redis.multi()
    .lpush('clicks', JSON.stringify({
      l: link.id, t: Date.now(), r: req.get('referer') || null,
      ua: req.get('user-agent') || '', c: req.get('cf-ipcountry') || null,
    }))
    .ltrim('clicks', 0, 99999)
    .exec().catch(() => {});
  res.redirect(302, link.url);
}));

app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  log('error', err.message, { path: req.path });
  res.status(err.status || 500).json({ error: err.status ? err.message : 'Terjadi kesalahan pada server.' });
});

const server = app.listen(config.port, () => log('info', 'api listening', { port: config.port }));
const shutdown = () => {
  log('info', 'shutting down');
  server.close(async () => {
    await Promise.allSettled([pool.end(), redis.quit()]);
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10000).unref();
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
