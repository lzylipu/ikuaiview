# 📊 iKuaiView

<p align="center">
  <img src="dist/ikuaiview-logo.png" alt="iKuaiView logo" width="128" height="128" />
</p>

<p align="center">
  <strong>Read-only LAN dashboard for iKuai routers</strong><br>
  <code>ikuai-exporter + Prometheus + Web UI → one-shot Docker Compose</code>
</p>

> 📖 **Full bilingual documentation lives in [README.md](./README.md)**  
> Jump to English section: [English](./README.md#-english)

---

## 🚀 One-shot deploy

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

- Docker Hub: `lzylipu/ikuaiview:latest`
- GHCR: `ghcr.io/lzylipu/ikuaiview:latest`


```text
lzylipu/ikuaiview:latest
```

## 🔐 Notes

- Read-only iKuai account only
- Never commit real `.env`
- Board default port **3000**

## 📄 License

[MIT](./LICENSE)
