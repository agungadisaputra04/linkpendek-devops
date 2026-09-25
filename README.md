# LinkPendek

URL shortener dengan click analytics. Project ini digunakan untuk membangun workflow DevOps end-to-end di homelab, mulai dari Docker, Jenkins CI, security scanning, sampai deployment ke Kubernetes.

> **Status:** CI sudah berjalan. Image berhasil di-build, di-test, melewati Trivy security gate, dan dipublish ke GHCR.

## DevOps Workflow

```text
GitHub → Jenkins → Test → npm audit → Docker Build → Trivy → GHCR
```

Development dilakukan melalui feature branch dan Pull Request sebelum masuk ke `main`.

## Stack

- Node.js + Express
- PostgreSQL
- Redis
- Docker
- Jenkins
- Trivy
- GitHub Container Registry
- Kubernetes / k3s
- Prometheus + Grafana

## Architecture

```text
          API
           │
           ▼
         Redis
         Queue
           │
           ▼
         Worker
           │
           ▼
       PostgreSQL
```

API menangani link dan redirect. Click event diproses secara asynchronous oleh worker melalui Redis.

## DevOps Progress

- [x] Dockerize API & worker
- [x] Multi-stage build & non-root container
- [x] Jenkins CI
- [x] Automated test & `npm audit`
- [x] Trivy security gate
- [x] Push image ke GHCR
- [ ] CD ke homelab
- [ ] Kubernetes / k3s
- [ ] Monitoring & alerting
- [ ] Backup & restore
- [ ] Load testing
- [ ] GitOps dengan Argo CD

## Documentation

- [Container Security Hardening](docs/security/container-security.md)

## Run Locally

```bash
npm ci
npm run migrate
npm run start:api
npm run start:worker
npm test
```