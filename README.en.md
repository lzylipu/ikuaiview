# 📊 iKuaiView

<p align="center">
  <img src="dist/ikuaiview-logo.png" alt="iKuaiView logo" width="128" height="128" />
</p>

<p align="center">
  <strong>Read-only LAN dashboard for iKuai routers</strong><br>
  <code>Official 3-service Compose template: exporter + Prometheus + board</code>
</p>

> 📖 Full bilingual docs: **[README.md](./README.md)**  
> English jump: [English](./README.md#-english)

## 🚀 One-shot

```bash
git clone https://github.com/lzylipu/ikuaiview.git
cd ikuaiview
sh scripts/bootstrap.sh
# edit .env
docker-compose pull
docker-compose up -d
# http://<host>:3000
```

## 📦 Image

```text
lzylipu/ikuaiview:latest
# or ghcr.io/lzylipu/ikuaiview:latest
```

## 📁 Generic layout

```text
./docker-compose.yml
./.env
./prometheus/prometheus.yml
./prometheus-data/
```

## 🔌 Ports

| Service | Host |
|:--------|:-----|
| Board | 3000 |
| Exporter | 9191 |
| Prometheus | 9192 |

## 🔐 Notes

- Read-only iKuai account only
- Never commit real `.env`
- Use relative paths in compose (no personal NAS secrets)

## 📄 License

[MIT](./LICENSE)
