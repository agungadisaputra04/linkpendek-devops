const http = require('http');
const client = require('prom-client');
const { config, pool, redis, log } = require('./common');
const { classifyDevice, refererHost } = require('./util');

client.collectDefaultMetrics();
const processed = new client.Counter({ name: 'clicks_processed_total', help: 'Event klik diproses', labelNames: ['result'] });
const batchDuration = new client.Histogram({
  name: 'click_batch_duration_seconds', help: 'Durasi insert batch',
  buckets: [0.005, 0.01, 0.05, 0.1, 0.5, 1, 5],
});

const blocking = redis.duplicate(); // koneksi khusus untuk BRPOP
let running = true;

async function flush(batch) {
  const end = batchDuration.startTimer();
  const values = [];
  const params = [];
  batch.forEach((e, i) => {
    const o = i * 5;
    values.push(`($${o + 1}, to_timestamp($${o + 2}::double precision / 1000), $${o + 3}, $${o + 4}, $${o + 5})`);
    params.push(e.l, e.t, refererHost(e.r), classifyDevice(e.ua), e.c);
  });
  try {
    await pool.query(`INSERT INTO click_events (link_id, ts, referrer, device, country) VALUES ${values.join(',')}`, params);
    processed.inc({ result: 'ok' }, batch.length);
  } catch (err) { // at-most-once: batch yang gagal dibuang dan dicatat
    processed.inc({ result: 'error' }, batch.length);
    log('error', 'batch insert gagal', { error: err.message, size: batch.length });
  }
  end();
}

async function loop() {
  while (running) {
    try {
      const first = await blocking.brpop('clicks', 2);
      if (!first) continue;
      const batch = [JSON.parse(first[1])];
      while (batch.length < 500) {
        const next = await redis.rpop('clicks');
        if (!next) break;
        batch.push(JSON.parse(next));
      }
      await flush(batch);
    } catch (err) {
      log('error', 'worker loop error', { error: err.message });
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
}

const metricsServer = http.createServer(async (req, res) => {
  if (req.url === '/healthz') return res.end('ok');
  res.setHeader('Content-Type', client.register.contentType);
  res.end(await client.register.metrics());
}).listen(config.workerMetricsPort, () => log('info', 'worker started', { metricsPort: config.workerMetricsPort }));

const shutdown = () => {
  running = false;
  metricsServer.close();
  setTimeout(async () => {
    await Promise.allSettled([pool.end(), redis.quit(), blocking.quit()]);
    process.exit(0);
  }, 2500);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

loop();
