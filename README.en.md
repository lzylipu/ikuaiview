# iKuaiView

<p align="center">
  <img src="dist/ikuaiview-logo.png" alt="iKuaiView logo" width="128" height="128" />
</p>

<p align="center"><b>Read-only LAN dashboard for iKuai routers</b></p>

English | [简体中文](./README.md)

**iKuaiView** is a **read-only LAN dashboard** for [iKuai](https://www.ikuai8.com/) routers.  
It consolidates live status, WAN/PPPoE details, historical throughput, network service summaries, and online clients into a single Docker-deployable web UI.

> Goals: local deployment, simple configuration, real data, clear layout.  
> This project **never writes** router configuration. It only consumes read-only APIs and metrics.

---

## Features

- **System overview**: CPU, memory, uptime, firmware version, online client count
- **WAN / PPPoE**: public IP, gateway, WAN DNS, link state, dial duration, connection time
- **Traffic**: monthly/recorded usage, live up/down rates, total/TCP/UDP/ICMP connections
- **History chart**: Prometheus-backed WAN throughput for 1 hour / 24 hours
- **Network services**: DHCP range & free leases, port forwards, four TCP latency probes
- **Online clients table**: name / IP / MAC / live rates / totals / connections, sortable
- **Themes**: system / dark / light
- **Mobile layout**: system → network → rates → devices reading order

---

## Architecture

```text
                    ┌──────────────────────────┐
                    │   iKuai Router (read-only)│
                    └────────────┬─────────────┘
                                 │
              ┌──────────────────┼──────────────────┐
              │                  │                  │
              v                  v                  v
     jakes/ikuai-exporter   prom/prometheus    iKuai read-only API
        :9090 (metrics)      (WAN history)     (PPPoE/DHCP/DNAT)
              │                  │                  │
              └──────────────────┼──────────────────┘
                                 v
                        iKuaiView gateway
                           host:3000
                     (static UI + WebSocket)
```

| Component | Image / process | Role |
| --- | --- | --- |
| Exporter | `jakes/ikuai-exporter` | Live metrics: system, interfaces, clients |
| Time series | `prom/prometheus` | WAN history |
| Dashboard | this repo `ikuaiview` | Python gateway + static frontend |

---

## Quick start
### 1. Requirements

- Docker Engine
- Docker Compose v1 (`docker-compose`) or a compatible Compose plugin
- Reachable iKuai web/API endpoint
- An **iKuai read-only account** (prefer a dedicated API user)

### 2. Get the code

```bash
git clone https://github.com/lzylipu/ikuaiview.git
cd ikuaiview
```

### 3. Prepare config & templates

```bash
# recommended: create .env / prometheus template / data dir
sh scripts/bootstrap.sh

# then fill real credentials
# nano .env
```

Minimum `.env`:

```env
IKUAI_URL=http://your-ikuai-host
IKUAI_USERNAME=readonly-user
IKUAI_PASSWORD=readonly-password
```

### 4. One-shot start (full stack)

By default Compose pulls the published image `ghcr.io/lzylipu/ikuaiview:latest` and starts:

1. `jakes/ikuai-exporter`
2. `prom/prometheus`
3. `ikuaiview` (dashboard `:3000`)

```bash
docker-compose pull
docker-compose up -d
```

Local source build for the dashboard image:

```bash
docker-compose up -d --build
```

Open:

```text
http://<host-ip>:3000
```

Default ports:

| Service | Host port | Container port | Notes |
| --- | --- | --- | --- |
| iKuaiView | **3000** | 3000 | Dashboard entry |
| ikuai-exporter | 9191 | 9090 | metrics (optional expose) |
| Prometheus | 9090 | 9090 | TSDB UI (optional expose) |

Override host ports with `IKUAIVIEW_PORT` / `IKUAI_EXPORTER_PORT` / `PROMETHEUS_PORT` in `.env`.

### 5. Verify

```bash
docker-compose ps
curl -fsS -o /dev/null -w '%{http_code}
' http://127.0.0.1:3000/
curl -fsS http://127.0.0.1:9191/metrics | head
curl -fsS http://127.0.0.1:9090/api/v1/targets | head
```

After opening the UI, **wait 10-15 seconds** for the first WebSocket snapshot. Initial placeholders are loading state, not final values.

## Configuration

### Environment variables

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `IKUAI_URL` | yes | — | iKuai web/API base URL |
| `IKUAI_USERNAME` | yes | — | read-only API username |
| `IKUAI_PASSWORD` | yes | — | read-only API password |
| `IKUAI_MODULES` | no | `sysStat,lanDevice,interfaceInfo` | exporter modules |
| `IKUAI_INSECURE_SKIP` | no | `true` | skip TLS verification |
| `IKUAI_LEVEL` | no | `info` | exporter log level |
| `IKUAI_EXPORTER_URL` | no | `http://ikuai-exporter:9090` | exporter URL seen by dashboard |
| `PROMETHEUS_URL` | no | `http://prometheus:9090` | Prometheus URL seen by dashboard |
| `IKUAI_PORT` | no | `3000` | dashboard listen port in container |
| `IKUAIVIEW_PORT` | no | `3000` | host port for dashboard |
| `IKUAI_EXPORTER_PORT` | no | `9191` | host port for exporter |
| `PROMETHEUS_PORT` | no | `9090` | host port for Prometheus |
| `PROMETHEUS_RETENTION` | no | `30d` | TSDB retention |

> Inside Compose, prefer service DNS names `ikuai-exporter` / `prometheus`. Avoid host-mapped IPs for inter-container traffic.

### Prometheus template

First boot requires:

```text
./prometheus/prometheus.yml
```

The shipped template scrapes:

```yaml
targets:
  - ikuai-exporter:9090
```

That is the **service name + container port 9090**.  
If you rename services/networks, update this file and run:

```bash
docker-compose up -d prometheus
```

---

## Operations

```bash
docker-compose logs -f ikuaiview
docker-compose restart ikuaiview
docker-compose up -d --build
docker-compose down
```

---

## Data sources

| UI data | Source |
| --- | --- |
| CPU / memory / live rates / client rates / connections | `ikuai-exporter` `/metrics` |
| WAN 1h / 24h chart | Prometheus |
| PPPoE, WAN DNS, DHCP, DNAT, monthly/interface totals | iKuai read-only API |
| Client display names | DHCP static bindings by IP first |
| Latency probes | dashboard container **TCP connect RTT** (not ICMP) |

Notes:

1. With OpenClash/Fake-IP, GitHub/YouTube may resolve to `198.18.0.0/15`; sub-ms RTT means local proxy ingress only.
2. Client names are matched by **IP**, not shared MAC.
3. No iKuai write APIs are called.

---

## Security

- Expose `:3000` only on trusted LAN / VPN / reverse proxy
- Use a dedicated **read-only** iKuai account
- Never commit a real `.env`
- Avoid pasting credentials or internal asset maps into issues

Ignored by git:

```text
.env
prometheus-data/
```

---

## Repository layout

```text
ikuaiview/
├── README.md
├── README.en.md
├── LICENSE
├── Dockerfile
├── docker-compose.yml
├── .env.example
├── .gitignore
├── gateway.py
├── prometheus/prometheus.yml
└── dist/
```

---

## Troubleshooting

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| UI stuck at 0 / — | WS snapshot not ready | wait 10–15s, hard refresh |
| exporter unhealthy | bad iKuai credentials/URL | check `.env` and exporter logs |
| empty history chart | Prometheus target down | verify `prometheus/prometheus.yml` → `ikuai-exporter:9090` |
| Prometheus cannot write | volume permissions | compose runs as root; ensure `prometheus-data` is writable |
| containers cannot talk | host-mapped IPs used | switch back to service names |
| wrong client names | no DHCP static remarks | set remarks by IP in iKuai DHCP static table |

---

## Optional frontend rebuild

Runtime does **not** need Node.js; `dist/` is included.  
If you rebuild frontend sources:

```bash
pnpm install && pnpm typecheck && pnpm build && pnpm bundle:check
rm -rf /path/to/ikuaiview/dist
cp -a dist/. /path/to/ikuaiview/dist/
cd /path/to/ikuaiview && docker-compose up -d --build ikuaiview
```

---

## Docker image & CI
The dashboard image is built by GitHub Actions and published to **GHCR**:

```text
ghcr.io/lzylipu/ikuaiview:latest
ghcr.io/lzylipu/ikuaiview:sha-<short>
```

- Workflow: `.github/workflows/docker-publish.yml`
- Triggers: push to `main`, `v*` tags, manual `workflow_dispatch`
- Compose default: `IKUAIVIEW_IMAGE=ghcr.io/lzylipu/ikuaiview:latest`
- Local build remains available: `docker-compose up -d --build`

If the package is private:

```bash
echo $GITHUB_TOKEN | docker login ghcr.io -u USERNAME --password-stdin
```

Public packages can usually be pulled without login.

## Acknowledgements

- Visual language inspired by open-source network dashboard layouts (data contracts and information architecture implemented independently)
- Live metrics via community image `jakes/ikuai-exporter`
- History via [Prometheus](https://prometheus.io/)

Gateway integration, data contracts, information architecture, and mobile adaptations are maintained in this project.

---

## License

See [LICENSE](./LICENSE).  
Third-party images and upstream design assets remain under their own licenses.

---

## Contributing

Issues and PRs are welcome. Before submitting:

1. No real `.env`, passwords, or private inventory
2. `docker-compose config` succeeds
3. Fresh-directory first-run steps in the docs still work