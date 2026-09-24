const { Pool } = require('pg');
const Redis = require('ioredis');

const env = process.env;
const config = {
  port: +env.PORT || 3000,
  baseUrl: (env.BASE_URL || 'http://localhost:3000').replace(/\/$/, ''),
  databaseUrl: env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/linkpendek',
  redisUrl: env.REDIS_URL || 'redis://localhost:6379',
  rateLimitPerMin: +env.RATE_LIMIT_PER_MIN || 20,
  workerMetricsPort: +env.WORKER_METRICS_PORT || 9101,
};

const pool = new Pool({ connectionString: config.databaseUrl, max: +env.PG_POOL_MAX || 10 });
const redis = new Redis(config.redisUrl, { maxRetriesPerRequest: 2 });
const log = (level, msg, extra = {}) =>
  console.log(JSON.stringify({ ts: new Date().toISOString(), level, msg, ...extra }));

pool.on('error', (e) => log('error', 'pg pool error', { error: e.message }));
redis.on('error', (e) => log('error', 'redis error', { error: e.message }));

module.exports = { config, pool, redis, log };
