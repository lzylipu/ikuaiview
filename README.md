# 📊 iKuaiView

<p align="center">
  <img src="dist/ikuaiview-logo.png" alt="iKuaiView logo" width="128" height="128" />
</p>

<p align="center">
  <strong>iKuai（爱快）只读局域网监控看板</strong><br>
  <code>ikuai-exporter + Prometheus + Web 看板 → 一套 Compose 模板直接跑</code>
</p>

<p align="center">
  <a href="https://github.com/lzylipu/ikuaiview/actions/workflows/docker-publish.yml"><img src="https://img.shields.io/github/actions/workflow/status/lzylipu/ikuaiview/docker-publish.yml?style=flat-square&label=docker%20build" alt="Docker Build"></a>
  <a href="https://hub.docker.com/r/lzylipu/ikuaiview"><img src="https://img.shields.io/docker/v/lzylipu/ikuaiview?sort=semver&style=flat-square&label=docker%20hub" alt="Docker Hub"></a>
  <a href="https://github.com/lzylipu/ikuaiview/pkgs/container/ikuaiview"><img src="https://img.shields.io/badge/ghcr.io-lzylipu%2Fikuaiview-blue?style=flat-square" alt="GHCR"></a>
  <img src="https://img.shields.io/badge/board%20port-3000-green?style=flat-square" alt="Port">
  <img src="https://img.shields.io/badge/license-MIT-yellow?style=flat-square" alt="License">
</p>

---

[中文] | [English](#-english)

## ✨ 核心特性

- 🖥️ **系统状态** — CPU / 内存 / 运行时长 / 固件版本 / 在线终端数
- 🌐 **WAN / PPPoE** — 公网 IP、网关、WAN DNS、线路状态、拨号时长
- 📈 **实时 + 历史流量** — 实时上下行，Prometheus 1 小时 / 24 小时曲线
- 📦 **用量与连接** — 本月/累计用量、总连接 / TCP / UDP / ICMP
- 🧩 **网络服务** — DHCP、端口转发、四路 TCP 延迟探测
- 📱 **在线终端表** — 名称 / IP / MAC / 速率 / 流量 / 连接数
- 🎨 **主题** — 跟随系统 / 暗色 / 亮色
- 🔒 **只读** — 不改路由器配置
- 🐳 **官方三件套模板** — exporter + Prometheus + 看板，复制即可部署

---

## 🏗️ 架构

```text
iKuai（只读 API）
   ├─ ① jakes/ikuai-exporter   实时 metrics（:9090）
   ├─ ② prom/prometheus        WAN 历史时序
   └─ ③ lzylipu/ikuaiview      看板 + 网关（主机 :3000）
```

| 容器 | 镜像 | 主机端口 | 作用 |
|:-----|:-----|:---------|:-----|
| ① `ikuai-exporter` | `jakes/ikuai-exporter:latest` | **9191** | 采集爱快实时指标 |
| ② `ikuai-prometheus` | `prom/prometheus:latest` | **9192** | 存储 WAN 历史 |
| ③ `ikuaiview` | `lzylipu/ikuaiview:latest` | **3000** | Web 看板（替代 Grafana） |

---

## 📁 推荐目录结构（通用）

任意机器上都用相对路径，**不要写死个人 NAS 路径**：

```text
ikuaiview/                      # 或你自己的目录名
├── docker-compose.yml          # 官方三件套模板
├── .env                        # 本地凭据（勿提交）
├── .env.example                # 凭据模板
├── prometheus/
│   └── prometheus.yml          # Prometheus 抓取模板
└── prometheus-data/            # 运行时自动生成的时序数据
```

群晖 / NAS 示例（路径请换成你自己的）：

```text
/volumeX/docker/ikuaiview/
├── docker-compose.yml
├── .env
├── prometheus/prometheus.yml
└── prometheus-data/
```

---

## 🚀 快速开始（官方部署模板）

### ① 准备目录与配置

```bash
# 方式 A：直接 clone 本仓库
git clone https://github.com/lzylipu/ikuaiview.git
cd ikuaiview
sh scripts/bootstrap.sh

# 方式 B：自建目录
mkdir -p ikuaiview/prometheus ikuaiview/prometheus-data
cd ikuaiview
# 放入 docker-compose.yml、prometheus/prometheus.yml、.env
```

### ② `.env`（只放本地，勿提交）

```env
IKUAI_URL=http://192.168.1.1
IKUAI_USERNAME=api
IKUAI_PASSWORD=change-me
```

> ⚠️ 使用 **iKuai 只读账号**。不要把真实密码写进 compose 或 Git。

### ③ `prometheus/prometheus.yml`（首次必须存在）

```yaml
global:
  scrape_interval: 15s
  evaluation_interval: 15s

scrape_configs:
  - job_name: ikuai
    static_configs:
      - targets:
          - ikuai-exporter:9090
```

> 目标是 **Compose 服务名 + 容器端口 9090**，不是主机映射端口 9191。

### ④ `docker-compose.yml`（官方模板）

下面这套就是推荐给所有人直接用的模板（仓库根目录已同步）：

```yaml
version: "3.8"

services:
  # ===== 1. ikuai-exporter: 采集器 =====
  ikuai-exporter:
    image: jakes/ikuai-exporter:latest
    container_name: ikuai-exporter
    restart: always
    environment:
      IKUAI_URL: "${IKUAI_URL}"
      IKUAI_USERNAME: "${IKUAI_USERNAME}"
      IKUAI_PASSWORD: "${IKUAI_PASSWORD}"
      IKUAI_MODULES: "sysStat,lanDevice,interfaceInfo"
      IKUAI_INSECURE_SKIP: "true"
      IKUAI_LEVEL: "info"
    ports:
      - "9191:9090"
    networks:
      - ikuai-monitor

  # ===== 2. Prometheus: 时序数据库 =====
  prometheus:
    image: prom/prometheus:latest
    container_name: ikuai-prometheus
    restart: always
    user: "root"   # 避免挂载目录无写权限导致 panic
    volumes:
      # 通用相对路径；NAS 可改成自己的绝对路径
      - ./prometheus/prometheus.yml:/etc/prometheus/prometheus.yml:ro
      - ./prometheus-data:/prometheus
    command:
      - "--config.file=/etc/prometheus/prometheus.yml"
      - "--storage.tsdb.path=/prometheus"
      - "--storage.tsdb.retention.time=30d"
      - "--web.enable-lifecycle"
    ports:
      - "9192:9090"
    depends_on:
      - ikuai-exporter
    networks:
      - ikuai-monitor

  # ===== 3. ikuaiview: 看板（替代 Grafana）=====
  ikuaiview:
    # Docker Hub 默认；也可：ghcr.io/lzylipu/ikuaiview:latest
    image: ${IKUAIVIEW_IMAGE:-lzylipu/ikuaiview:latest}
    container_name: ikuaiview
    restart: always
    environment:
      IKUAI_URL: "${IKUAI_URL}"
      IKUAI_USERNAME: "${IKUAI_USERNAME}"
      IKUAI_PASSWORD: "${IKUAI_PASSWORD}"
      # 容器内互访必须用服务名，不要写宿主机 IP
      IKUAI_EXPORTER_URL: "http://ikuai-exporter:9090"
      PROMETHEUS_URL: "http://prometheus:9090"
      IKUAI_PORT: "3000"
    ports:
      # 默认 3000；若要 91xx 习惯可改为 "9193:3000"
      - "3000:3000"
    depends_on:
      - ikuai-exporter
      - prometheus
    networks:
      - ikuai-monitor

networks:
  ikuai-monitor:
    driver: bridge
```

### ⑤ 启动

```bash
docker-compose pull
docker-compose up -d
```

| 服务 | 访问地址 |
|:-----|:---------|
| **看板 iKuaiView** | `http://<主机IP>:3000` |
| exporter | `http://<主机IP>:9191/metrics` |
| Prometheus | `http://<主机IP>:9192` |

打开看板后请等待 **10–15 秒** 让 WebSocket 首包到达。

### ⑥ 验证

```bash
docker-compose ps
curl -fsS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3000/
curl -fsS http://127.0.0.1:9191/metrics | head
curl -fsS http://127.0.0.1:9192/-/ready
curl -fsS http://127.0.0.1:3000/api/health
```

---

## 📦 镜像

| 仓库 | 镜像 |
|:-----|:-----|
| **Docker Hub（默认）** | `lzylipu/ikuaiview:latest` |
| GHCR（同步） | `ghcr.io/lzylipu/ikuaiview:latest` |

```bash
docker pull lzylipu/ikuaiview:latest
# 或
docker pull ghcr.io/lzylipu/ikuaiview:latest
```

CI：`.github/workflows/docker-publish.yml`（`main` / `v*` / 手动）同时推送 Docker Hub + GHCR。

---

## ⚙️ 配置说明

### 环境变量（`.env`）

| 变量 | 必填 | 说明 |
|:-----|:----:|:-----|
| `IKUAI_URL` | ✅ | 爱快 Web/API 地址，如 `http://192.168.1.1` |
| `IKUAI_USERNAME` | ✅ | 只读 API 用户名 |
| `IKUAI_PASSWORD` | ✅ | 只读 API 密码（仅本地 `.env`） |
| `IKUAIVIEW_IMAGE` | ❌ | 默认 `lzylipu/ikuaiview:latest` |

### 端口一览

| 服务 | 主机端口 | 容器端口 |
|:-----|:---------|:---------|
| iKuaiView | 3000 | 3000 |
| exporter | 9191 | 9090 |
| Prometheus | 9192 | 9090 |

### 路径说明

| 挂载 | 通用写法 | 说明 |
|:-----|:---------|:-----|
| Prometheus 配置 | `./prometheus/prometheus.yml` | 只读挂载 |
| Prometheus 数据 | `./prometheus-data` | 可写数据目录 |

若你在群晖等环境坚持绝对路径，只需改 volumes，例如：

```yaml
- /volumeX/docker/ikuaiview/prometheus/prometheus.yml:/etc/prometheus/prometheus.yml:ro
- /volumeX/docker/ikuaiview/prometheus-data:/prometheus
```

其余服务定义保持不变。

---

## 📡 数据来源

| 面板内容 | 数据源 |
|:---------|:-------|
| CPU / 内存 / 实时速率 / 终端 / 连接数 | `ikuai-exporter` |
| WAN 1h / 24h 曲线 | Prometheus |
| PPPoE / DHCP / 端口转发 / 本月用量 | iKuai 只读 API |
| 延迟 | 看板容器 TCP connect RTT（非 ICMP） |

**不会** 调用 iKuai 写接口。

---

## 🛠️ 运维

```bash
docker-compose logs -f ikuaiview
docker-compose logs -f ikuai-exporter
docker-compose logs -f prometheus
docker-compose restart ikuaiview
docker-compose up -d
docker-compose down
```

---

## 🧯 故障排查

| 现象 | 处理 |
|:-----|:-----|
| 页面一直 0 / — | 等 10–15 秒后硬刷新 |
| exporter 起不来 | 检查 `.env` 爱快地址/只读账号 |
| 历史曲线空白 | 确认 `prometheus.yml` 目标为 `ikuai-exporter:9090` |
| Prometheus 无写权限 | 已用 `user: root`；确认 `prometheus-data` 可写 |
| 容器互访失败 | 内部 URL 用服务名，不要写宿主机 IP |
| 拉不到镜像 | `docker pull lzylipu/ikuaiview:latest` 或改用 GHCR 镜像 |

---

## 🔐 安全

- 仅在受控局域网 / VPN / 反代后暴露 `:3000`
- 使用只读爱快账号
- **永不提交** 真实 `.env`
- Issue / 截图不要贴密码和内网资产明细

---

## 🤝 贡献

欢迎 Issue / PR。提交前确认：

1. 无真实密码 / 私有路径 / 内网资产
2. `docker-compose config` 可通过
3. 文档模板可在干净目录复现

---

## 📄 License

[MIT](./LICENSE)

---

## 🙏 致谢

- 采集：`jakes/ikuai-exporter`
- 时序：[Prometheus](https://prometheus.io/)
- 前端：Vue 3 生态

网关对接、数据契约与面板信息架构由本项目独立维护。

---
---

# 🌐 English

## 🚀 Official deploy template

```bash
git clone https://github.com/lzylipu/ikuaiview.git
cd ikuaiview
sh scripts/bootstrap.sh
# edit .env with iKuai read-only credentials
docker-compose pull
docker-compose up -d
# board: http://<host>:3000
```

### Ports

| Service | Host port |
|:--------|:----------|
| iKuaiView board | **3000** |
| exporter | 9191 |
| Prometheus | 9192 |

### Generic paths

```text
./prometheus/prometheus.yml
./prometheus-data/
./.env
```

Do **not** hardcode personal NAS paths or secrets in compose.

### Images

- Docker Hub: `lzylipu/ikuaiview:latest`
- GHCR: `ghcr.io/lzylipu/ikuaiview:latest`

### Minimal `.env`

```env
IKUAI_URL=http://192.168.1.1
IKUAI_USERNAME=api
IKUAI_PASSWORD=change-me
```

Full Chinese section above contains the complete `docker-compose.yml` template used by this repository.

## 📄 License

[MIT](./LICENSE)
