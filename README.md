# linkpendek: serah terima dari developer ke DevOps

URL shortener dengan analitik klik. Repo ini hanya berisi **kode aplikasi**. Dockerfile, Compose, CI/CD, Kubernetes, dan monitoring sengaja tidak disertakan: itu bagian DevOps.

## Komponen

Satu codebase, dua proses (bisa satu image dengan perintah start berbeda):

| Proses | Perintah | Port | Fungsi |
|---|---|---|---|
| API + frontend statis | `npm run start:api` | `PORT` (3000) | REST API, redirect, sajian `public/` |
| Worker | `npm run start:worker` | `WORKER_METRICS_PORT` (9101) | Memindahkan event klik dari Redis ke Postgres |

Dependensi eksternal: **PostgreSQL 14+**, **Redis 6+**. Runtime: **Node.js 20+**.

## Konfigurasi (environment variable)

| Variabel | Default | Keterangan |
|---|---|---|
| `PORT` | `3000` | Port API |
| `BASE_URL` | `http://localhost:3000` | URL publik, dipakai membentuk link pendek dan menolak link ke domain sendiri |
| `DATABASE_URL` | `postgres://postgres:postgres@localhost:5432/linkpendek` | Koneksi Postgres |
| `REDIS_URL` | `redis://localhost:6379` | Koneksi Redis |
| `RATE_LIMIT_PER_MIN` | `20` | Batas pembuatan link per IP per menit |
| `PG_POOL_MAX` | `10` | Ukuran pool Postgres |
| `WORKER_METRICS_PORT` | `9101` | Port metrics dan health worker |

Contoh ada di `.env.example`.

## Menjalankan lokal

```bash
npm ci
npm run migrate      # idempotent, aman dijalankan berulang (cocok untuk init job)
npm run start:api    # terminal 1
npm run start:worker # terminal 2
npm test             # unit test (tanpa database)
```

## Endpoint

| Method | Path | Keterangan |
|---|---|---|
| GET | `/` | Frontend |
| POST | `/api/links` | Body: `{ url, slug?, ttl_days? }`. Rate limit per IP |
| GET | `/api/links/:slug/stats` | Total klik, 7 hari terakhir, top referrer, perangkat |
| GET | `/api/stats/summary` | Total link dan klik (cache 30 detik) |
| GET | `/:slug` | Redirect 302 dan pencatatan klik |
| GET | `/healthz` | Liveness (tanpa cek dependensi) |
| GET | `/readyz` | Readiness (cek Postgres dan Redis, 503 jika gagal) |
| GET | `/metrics` | Prometheus |

Worker: `GET :9101/healthz` dan `GET :9101/metrics`.

## Metrik kustom

- API: `http_request_duration_seconds{method,route,status}`, `redirect_cache_total{result=hit|miss}`, `links_created_total`, `rate_limited_total`, `click_queue_length` (ditambah metrik default Node.js)
- Worker: `clicks_processed_total{result=ok|error}`, `click_batch_duration_seconds`

## Yang perlu diketahui DevOps

- **API stateless**, aman di-scale horizontal. Worker juga aman berjalan lebih dari satu replika (BRPOP atomik).
- **Antrean klik ada di Redis (list `clicks`)**, dibatasi 100.000 event. Jika Redis restart tanpa persistence, event yang belum diproses hilang. Delivery bersifat at-most-once: batch yang gagal masuk Postgres dibuang dan dihitung di `clicks_processed_total{result="error"}`.
- Kegagalan Redis saat mencatat klik **tidak** menggagalkan redirect. Jika Redis mati total, redirect ikut gagal (cache dan rate limit bergantung padanya).
- Aplikasi mengharapkan berjalan **di belakang reverse proxy** (`trust proxy` aktif). IP klien dibaca dari `CF-Connecting-IP`, negara dari `CF-IPCountry` (jika lewat Cloudflare). IP tidak disimpan.
- **`/metrics` tidak diautentikasi.** Jangan diekspos ke publik lewat ingress.
- Menangani `SIGTERM` dengan graceful shutdown (API menunggu request selesai, maksimal 10 detik).
- Log berformat JSON ke stdout.
- Redirect memakai **302** (bukan 301) agar setiap klik terhitung. Cache redirect di Redis 24 jam atau sampai kedaluwarsa link.

## Batasan yang diketahui

- Tidak ada login: link dan statistiknya bersifat publik jika slug diketahui. Daftar "Link saya" hanya tersimpan di browser.
- Tidak ada fitur hapus atau nonaktifkan link dari UI (kolom `is_active` sudah tersedia).
- Belum ada linter dan tidak ada test integrasi (hanya unit test `test/util.test.js`).
- Tidak ada pemeriksaan URL berbahaya (phishing/malware). Hanya http/https yang diterima.

## Tugas untuk DevOps

- [ ] Containerize API dan worker (image kecil, non-root, healthcheck)
- [ ] Environment lokal lengkap dengan Postgres dan Redis
- [ ] Pipeline CI: install, test, build image, push ke registry
- [ ] Pipeline CD ke homelab
- [ ] Migrasi database sebagai langkah terpisah saat deploy
- [ ] Monitoring: scrape metrics API dan worker, dashboard, alert (antrean menumpuk, error rate, latensi p95)
- [ ] Ekspos ke publik dengan HTTPS dan proteksi `/metrics`
- [ ] Backup dan restore Postgres, uji restore
- [ ] Load test pada jalur redirect dan pembuatan link
- [ ] Deploy ke Kubernetes (readiness/liveness, resource limits, autoscaling)
