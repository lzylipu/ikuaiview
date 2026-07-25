# 📊 iKuaiView

<p align="center">
  <img src="dist/ikuaiview-logo.png" alt="iKuaiView logo" width="128" height="128" />
</p>

<p align="center">
  <strong>Read-only dashboard for iKuai routers · LAN or reverse-proxied public Internet</strong><br>
  <code>ikuai-exporter + Prometheus + Web board → one Compose template to run</code>
</p>

<p align="center">
  <a href="https://github.com/lzylipu/ikuaiview/actions/workflows/docker-publish.yml"><img src="https://img.shields.io/github/actions/workflow/status/lzylipu/ikuaiview/docker-publish.yml?style=flat-square&label=docker%20build" alt="Docker Build"></a>
  <a href="https://hub.docker.com/r/lzylipu/ikuaiview"><img src="https://img.shields.io/docker/v/lzylipu/ikuaiview?sort=semver&style=flat-square&label=docker%20hub" alt="Docker Hub"></a>
  <a href="https://github.com/lzylipu/ikuaiview/pkgs/container/ikuaiview"><img src="https://img.shields.io/badge/ghcr.io-lzylipu%2Fikuaiview-blue?style=flat-square" alt="GHCR"></a>
  <img src="https://img.shields.io/badge/board%20port-3000-green?style=flat-square" alt="Port">
  <img src="https://img.shields.io/badge/license-MIT-yellow?style=flat-square" alt="License">
</p>

---

[English] | [中文](./README.md)

## ✨ Key Features

- 🖥️ **System status** — CPU / memory / uptime / firmware version / online device count
- 🌐 **WAN / PPPoE** — public IP, gateway, WAN DNS, link status, dial uptime
- 📈 **Real-time + historical traffic** — live uplink/downlink, Prometheus 1h / 24h curves
- 📦 **Usage & connections** — monthly/cumulative traffic, total / TCP / UDP / ICMP connections
- 🧩 **Network services** — DHCP, port forwarding, 4-target TCP latency probing
- 📱 **Online device table** — name / IP / MAC / speed / traffic / connection count
- 🎨 **Theme** — system follow / dark / light
- 🔒 **Read-only** — server only accepts GET, WS never reads inbound frames, never modifies router configuration; safe to expose via reverse proxy to the public Internet
- 🐳 **Official 3-service template** — exporter + Prometheus + board, copy & deploy

---

## 🏗️ Architecture

```text
iKuai (read-only API)
   ├─ ① jakes/ikuai-exporter   live metrics (:9090)
   ├─ ② prom/prometheus        WAN historical time series
   └─ ③ lzylipu/ikuaiview      board + gateway (host :3000)
```

| Container | Image | Host port | Role |
|:-----|:-----|:---------|:-----|
| ① `ikuai-exporter` | `jakes/ikuai-exporter:latest` | **9191** | scrape iKuai live metrics |
| ② `ikuai-prometheus` | `prom/prometheus:latest` | **9192** | store WAN history |
| ③ `ikuaiview` | `lzylipu/ikuaiview:latest` | **3000** | web board (replaces Grafana) |

> ⚠️ Ports `3000` / `9191` / `9192` should be bound to the LAN interface or `127.0.0.1` only — do not publish them directly to the public Internet. Public ingress should go through a reverse proxy with authentication.

---

## 📁 Recommended directory layout (generic)

Use relative paths on any host. **Do not hardcode personal NAS paths**:

```text
ikuaiview/                      # or your own folder name
├── docker-compose.yml          # official 3-service template
├── .env                        # local credentials (do not commit)
├── .env.example                # credential template
├── prometheus/
│   └── prometheus.yml          # Prometheus scrape template
└── prometheus-data/            # auto-generated time-series data
```

Synology / NAS example (replace paths with your own):

```text
/volumeX/docker/ikuaiview/
├── docker-compose.yml
├── .env
├── prometheus/prometheus.yml
└── prometheus-data/
```

---

## 🚀 Quick start (official deploy template)

### ① Prepare directory & config

```bash
# Option A: clone this repo
git clone https://github.com/lzylipu/ikuaiview.git
cd ikuaiview
sh scripts/bootstrap.sh

# Option B: build your own directory
mkdir -p ikuaiview/prometheus ikuaiview/prometheus-data
cd ikuaiview
# add docker-compose.yml, prometheus/prometheus.yml, .env
```

### ② `.env` (local only, do not commit)

```env
IKUAI_URL=http://192.168.1.1
IKUAI_USERNAME=api
IKUAI_PASSWORD=change-me
```

> ⚠️ Use a **read-only iKuai account**. Never put real passwords in compose or Git.

### ③ `prometheus/prometheus.yml` (must exist on first run)

```yaml
global:
  scrape_interval: 30s
  evaluation_interval: 30s

scrape_configs:
  - job_name: ikuai
    static_configs:
      - targets:
          - ikuai-exporter:9090
```

> Target is **Compose service name + container port 9090**, not the host-mapped port 9191.
> `scrape_interval` recommends 30s (matches repo's `prometheus/prometheus.yml` and `scripts/bootstrap.sh` defaults; shorter intervals amplify iKuai API login/call frequency).

### ④ `docker-compose.yml` (official template)

The recommended template for everyone (also in repo root):

```yaml
version: "3.8"

services:
  # ===== 1. ikuai-exporter: scraper =====
  ikuai-exporter:
    image: jakes/ikuai-exporter:latest
    container_name: ikuai-exporter
    restart: unless-stopped
    environment:
      IKUAI_URL: ${IKUAI_URL}
      IKUAI_USERNAME: ${IKUAI_USERNAME}
      IKUAI_PASSWORD: ${IKUAI_PASSWORD}
    ports:
      - "9191:9090"

  # ===== 2. prometheus: time series =====
  ikuai-prometheus:
    image: prom/prometheus:latest
    container_name: ikuai-prometheus
    restart: unless-stopped
    volumes:
      - ./prometheus/prometheus.yml:/etc/prometheus/prometheus.yml:ro
      - ./prometheus-data:/prometheus
    ports:
      - "9192:9090"
    depends_on:
      - ikuai-exporter

  # ===== 3. ikuaiview: web board =====
  ikuaiview:
    image: lzylipu/ikuaiview:latest
    container_name: ikuaiview
    restart: unless-stopped
    environment:
      IKUAI_URL: ${IKUAI_URL}
      IKUAI_USERNAME: ${IKUAI_USERNAME}
      IKUAI_PASSWORD: ${IKUAI_PASSWORD}
      PROMETHEUS_URL: http://ikuai-prometheus:9090
    ports:
      - "3000:3000"
    depends_on:
      - ikuai-prometheus
```

### ⑤ Pull & start

```bash
docker-compose pull
docker-compose up -d
# board: http://<host>:3000
```

---

## 🔧 Environment variables

| Variable | Required | Default | Description |
|:---|:---:|:---|:---|
| `IKUAI_URL` | ✅ | — | iKuai admin URL, e.g. `http://192.168.1.1` |
| `IKUAI_USERNAME` | ✅ | — | read-only API account |
| `IKUAI_PASSWORD` | ✅ | — | password for above account |
| `PROMETHEUS_URL` | ✅ | `http://ikuai-prometheus:9090` | Prometheus query endpoint |
| `BOARD_PORT` | optional | `3000` | host port for the web board |
| `TZ` | optional | `Asia/Shanghai` | timezone for the board |

---

## 📊 Board panels

| Panel | Source | Refresh |
|:---|:---|:---|
| System status (CPU / mem / uptime / firmware) | iKuai API | 5s |
| WAN / PPPoE (public IP / gateway / DNS / dial uptime) | iKuai API | 5s |
| Real-time uplink / downlink | iKuai API | 2s |
| Historical traffic 1h / 24h curves | Prometheus | 15s |
| Monthly / cumulative usage | iKuai API | 60s |
| TCP / UDP / ICMP / total connections | iKuai API | 5s |
| DHCP & port-forwarding tables | iKuai API | 30s |
| 4-target TCP latency probing | iKuai API | 5s |
| Online device table (name / IP / MAC / speed / traffic / conns) | iKuai API | 5s |

---

## 🛠️ Build from source

```bash
git clone https://github.com/lzylipu/ikuaiview.git
cd ikuaiview
docker build -t lzylipu/ikuaiview:local .
```

The pre-built `dist/` is committed, so no frontend toolchain is required on the build host.

---

## 🔒 Security notes

- **Server-side is read-only by design** — only GET is accepted (no POST/PUT/DELETE); the WebSocket handler pushes `snapshot`/`update` frames and never reads inbound frames, so the backend cannot be written to from outside
- Only expose `:3000` behind a controlled LAN / VPN / reverse proxy
- **For public reverse-proxy deployments**: put authentication in front of the reverse proxy (BasicAuth / OAuth / mTLS) and add response headers `X-Frame-Options: DENY`, `Content-Security-Policy: default-src 'self'; connect-src 'self' ws: wss:; img-src 'self' data:; style-src 'self' 'unsafe-inline'`, `X-Content-Type-Options: nosniff`
- Inbound query parameters are whitelisted before being interpolated into any downstream PromQL construction (prevents PromQL injection; see `gateway.py /api/traffic`)
- `/api/config` is scrubbed — it does not leak LAN topology, the iKuai username, or the `accept_invalid_certs` flag
- The server never sends `Access-Control-Allow-Origin: *` (same-origin policy is enough; cross-site reads are blocked)
- Use a dedicated **read-only** iKuai account, never the admin password
- `.env` is gitignored by default — never commit real credentials
- All paths in compose are relative — no personal NAS paths leak into the template
- Multi-arch images published to both Docker Hub and GHCR (`linux/amd64` + `linux/arm64`)

---

## 📦 Image tags

| Registry | Image | Multi-arch |
|:---|:---|:---|
| Docker Hub | `lzylipu/ikuaiview:latest`, `lzylipu/ikuaiview:sha-<short>` | ✅ amd64 + arm64 |
| GHCR | `ghcr.io/lzylipu/ikuaiview:latest`, `ghcr.io/lzylipu/ikuaiview:sha-<short>` | ✅ amd64 + arm64 |

CI builds on every push to `main` and tags the commit short SHA, plus `latest` on the default branch.

---

## 📄 License

[MIT](./LICENSE)

---

## 🙏 Credits

- Scraper: `jakes/ikuai-exporter`
- Time series: [Prometheus](https://prometheus.io/)
- Frontend: Vue 3 ecosystem

Gateway integration, data contract, and board information architecture are maintained independently by this project.
