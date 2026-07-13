# 📊 iKuaiView

<p align="center">
  <img src="dist/ikuaiview-logo.png" alt="iKuaiView logo" width="128" height="128" />
</p>

<p align="center">
  <strong>iKuai（爱快）只读局域网监控看板</strong><br>
  <code>ikuai-exporter + Prometheus + Web 看板 → 一键 Docker Compose 部署</code>
</p>

<p align="center">
  <a href="https://github.com/lzylipu/ikuaiview/actions/workflows/docker-publish.yml"><img src="https://img.shields.io/github/actions/workflow/status/lzylipu/ikuaiview/docker-publish.yml?style=flat-square&label=docker%20build" alt="Docker Build"></a>
  <a href="https://github.com/lzylipu/ikuaiview/pkgs/container/ikuaiview"><img src="https://img.shields.io/badge/ghcr.io-lzylipu%2Fikuaiview-blue?style=flat-square" alt="GHCR"></a>
  <img src="https://img.shields.io/badge/port-3000-green?style=flat-square" alt="Port">
  <img src="https://img.shields.io/badge/license-MIT-yellow?style=flat-square" alt="License">
  <img src="https://img.shields.io/badge/iKuai-read--only-lightgrey?style=flat-square" alt="Read only">
</p>

---

[中文] | [English](#-english)

## ✨ 核心特性

- 🖥️ **系统状态** — CPU / 内存 / 运行时长 / 固件版本 / 在线终端数
- 🌐 **WAN / PPPoE** — 公网 IP、网关、WAN DNS、线路状态、拨号时长、连接时间
- 📈 **实时与历史流量** — 实时上下行 + Prometheus 1 小时 / 24 小时曲线
- 📦 **用量与连接** — 本月/累计用量、总连接 / TCP / UDP / ICMP
- 🧩 **网络服务** — DHCP 范围与剩余地址、端口转发、四路 TCP 延迟探测
- 📱 **在线终端表** — 名称 / IP / MAC / 实时速率 / 累计流量 / 连接数，可排序
- 🎨 **主题** — 跟随系统 / 暗色 / 亮色
- 📲 **移动端适配** — 系统 → 网络 → 速率 → 终端
- 🔒 **只读安全** — 不改路由器配置，推荐使用 iKuai 只读 API 账号
- 🐳 **一键部署** — exporter + Prometheus + 看板，Compose 全套拉起

---

## 🏗️ 架构

```text
                 ┌────────────────────────────┐
                 │   iKuai 路由器（只读 API）   │
                 └─────────────┬──────────────┘
                               │
           ┌───────────────────┼───────────────────┐
           │                   │                   │
           v                   v                   v
  jakes/ikuai-exporter   prom/prometheus     iKuai 只读 API
   实时 metrics:9090      WAN 历史时序        PPPoE/DHCP/DNAT
           │                   │                   │
           └───────────────────┼───────────────────┘
                               v
                      iKuaiView 网关 + 前端
                         主机端口 :3000
                      （静态页面 + WebSocket）
```

| 组件 | 镜像 / 进程 | 作用 |
|:-----|:------------|:-----|
| ① 采集器 | `jakes/ikuai-exporter` | 系统、接口、终端实时指标 |
| ② 时序库 | `prom/prometheus` | WAN 上下行历史曲线 |
| ③ 看板 | `lzylipu/ikuaiview` | Python 网关 + Vue 静态面板 |

> 💡 延迟探针 = 看板容器发出的 **TCP connect RTT**（不是 ICMP Ping）。  
> 若使用 Fake-IP / 代理，部分站点极低延迟仅代表本地代理入口。

---

## 📦 镜像与端口

| 仓库 | 镜像 |
|:-----|:-----|
| **Docker Hub（默认）** | `lzylipu/ikuaiview:latest` |
| GHCR（同步） | `ghcr.io/lzylipu/ikuaiview:latest` |


| 项目 | 默认值 |
|:-----|:-------|
| 看板镜像 | `lzylipu/ikuaiview:latest` |
| 看板端口 | **3000** |
| exporter 主机端口 | 9191 → 容器 9090 |
| Prometheus 主机端口 | 9090 → 容器 9090 |
| Compose 内服务名 | `ikuai-exporter` / `prometheus` / `ikuaiview` |

CI 自动构建：`.github/workflows/docker-publish.yml`  
触发：`main` 推送、`v*` 标签、手动运行。

---

## 🚀 快速开始

### ① 环境要求

- Docker Engine
- Docker Compose v1（`docker-compose`）或兼容插件
- 可访问的 iKuai Web/API
- **iKuai 只读账号**（强烈建议独立 API 用户，不要用超管）

### ② 获取项目

```bash
git clone https://github.com/lzylipu/ikuaiview.git
cd ikuaiview
```

### ③ 初始化配置（首次必做）

```bash
# 自动生成 .env / prometheus 模板 / 数据目录
sh scripts/bootstrap.sh

# 编辑真实凭据（不要提交 .env）
nano .env
```

`.env` 最少填写：

```env
IKUAI_URL=http://你的爱快地址
IKUAI_USERNAME=只读账号
IKUAI_PASSWORD=只读密码
```

> ⚠️ 仓库已忽略 `.env` 与 `prometheus-data/`。**切勿把真实密码写进 README / Issue / 截图。**

### ④ 一键启动（完整三件套）

```bash
docker-compose pull
docker-compose up -d
```

本地源码构建看板镜像：

```bash
docker-compose up -d --build
```

打开：

```text
http://<主机IP>:3000
```

### ⑤ 验证

```bash
docker-compose ps
curl -fsS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3000/
curl -fsS http://127.0.0.1:9191/metrics | head
curl -fsS http://127.0.0.1:9090/-/ready
curl -fsS http://127.0.0.1:3000/api/health
```

浏览器打开后请 **等待 10–15 秒** 让 WebSocket 首包到达；初始 `—` / `0` 是加载态。

---

## ⚙️ 配置说明

### 环境变量

| 变量 | 必填 | 默认值 | 说明 |
|:-----|:----:|:-------|:-----|
| `IKUAI_URL` | ✅ | — | iKuai Web/API 根地址 |
| `IKUAI_USERNAME` | ✅ | — | 只读 API 用户名 |
| `IKUAI_PASSWORD` | ✅ | — | 只读 API 密码（仅写本地 `.env`） |
| `IKUAI_MODULES` | ❌ | `sysStat,lanDevice,interfaceInfo` | exporter 采集模块 |
| `IKUAI_INSECURE_SKIP` | ❌ | `true` | 跳过 TLS 校验（内网常见） |
| `IKUAI_LEVEL` | ❌ | `info` | exporter 日志级别 |
| `IKUAIVIEW_IMAGE` | ❌ | `lzylipu/ikuaiview:latest` | 看板镜像（Docker Hub；也可 `ghcr.io/lzylipu/ikuaiview:latest`） |
| `IKUAIVIEW_PORT` | ❌ | `3000` | 看板主机端口 |
| `IKUAI_EXPORTER_PORT` | ❌ | `9191` | exporter 主机端口 |
| `PROMETHEUS_PORT` | ❌ | `9090` | Prometheus 主机端口 |
| `IKUAI_EXPORTER_URL` | ❌ | `http://ikuai-exporter:9090` | 看板访问 exporter |
| `PROMETHEUS_URL` | ❌ | `http://prometheus:9090` | 看板访问 Prometheus |
| `IKUAI_PORT` | ❌ | `3000` | 看板容器内监听端口 |
| `PROMETHEUS_RETENTION` | ❌ | `30d` | Prometheus 保留时长 |

> 🔗 Compose 网络内请用 **服务名**，不要写宿主机映射 IP，否则容器互访会失败。

### 首次文件模板

| 文件 | 作用 |
|:-----|:-----|
| `.env.example` | 环境变量模板 → 复制为 `.env` |
| `prometheus/prometheus.yml` | Prometheus 抓取配置（目标：`ikuai-exporter:9090`） |
| `scripts/bootstrap.sh` | 首次一键生成上述文件 + 数据目录 |
| `prometheus-data/` | Prometheus TSDB（运行时生成，已 gitignore） |

`prometheus.yml` 核心目标：

```yaml
scrape_configs:
  - job_name: ikuai
    static_configs:
      - targets:
          - ikuai-exporter:9090
```

---

## 📡 数据来源

| 面板内容 | 数据源 |
|:---------|:-------|
| CPU / 内存 / 实时速率 / 终端速率 / 连接数 | `ikuai-exporter` `/metrics` |
| WAN 1 小时 / 24 小时曲线 | Prometheus |
| PPPoE、WAN DNS、DHCP、端口转发、本月/接口累计 | iKuai 只读 API |
| 终端显示名 | 优先 DHCP 静态分配备注（按 **IP**） |
| 延迟探测 | 看板容器 TCP connect RTT |

**不会** 调用 iKuai 写接口。

---

## 🖥️ 面板布局

桌面两列四区：

```text
┌──────── 左（系统 / WAN） ────────┬──────── 右（速率） ────────┐
│ 系统状态 + WAN / PPPoE           │ 上下行实时 + 历史曲线       │
├──────────────────────────────────┼────────────────────────────┤
│ 网络服务 + 端口转发 + 延迟        │ 在线终端设备（卡内滚动）     │
└──────────────────────────────────┴────────────────────────────┘
```

移动端顺序：系统 → 网络 → 速率 → 终端。

---

## 🛠️ 常用运维

```bash
# 日志
docker-compose logs -f ikuaiview
docker-compose logs -f ikuai-exporter
docker-compose logs -f prometheus

# 重启 / 重建
docker-compose restart ikuaiview
docker-compose up -d --build

# 停止
docker-compose down
```

私有包拉取 GHCR（公开包通常不需要）：

```bash
echo $GITHUB_TOKEN | docker login ghcr.io -u <GitHub用户名> --password-stdin
docker pull lzylipu/ikuaiview:latest
```

---

## 🧯 故障排查

| 现象 | 可能原因 | 处理 |
|:-----|:---------|:-----|
| 页面一直 0 / — | WebSocket 尚未首包 | 等 10–15 秒后硬刷新 |
| exporter 起不来 | 爱快地址/账号错误 | 查 `.env` 与 `docker-compose logs ikuai-exporter` |
| 历史曲线空白 | Prometheus target 未 UP | 检查 `prometheus/prometheus.yml` 是否为 `ikuai-exporter:9090` |
| Prometheus 无写权限 | 数据目录权限 | compose 已 `user: root`；确认 `prometheus-data` 可写 |
| 容器间连不通 | 写了宿主机 IP | 改回服务名 URL |
| 终端名称不对 | 未配置 DHCP 静态备注 | 在爱快「DHCP 静态分配」按 IP 写备注 |
| GHCR 拉不动 | 网络限制 | `docker-compose up -d --build` 本地构建 |

---

## 📁 目录结构

```text
ikuaiview/
├── README.md                      # 中英双语文档（本文件）
├── LICENSE                        # MIT
├── Dockerfile                     # 看板镜像
├── docker-compose.yml             # 三件套一键部署
├── .env.example                   # 环境变量模板
├── .gitignore
├── .github/workflows/
│   └── docker-publish.yml         # 构建并推送 GHCR
├── gateway.py                     # Python 标准库网关
├── scripts/bootstrap.sh           # 首次初始化
├── prometheus/prometheus.yml      # Prometheus 模板
└── dist/                          # 预构建前端（含 logo）
```

---

## 🔐 安全建议

- 仅在受控局域网 / VPN / 反向代理后暴露 `:3000`
- 使用 **只读** iKuai 账号
- 永不提交真实 `.env`
- Issue / PR / 截图中不要粘贴内网资产表与密码

---

## 🧑‍💻 可选：前端二次构建

运行时 **不需要** Node.js（仓库已含 `dist/`）。若你维护前端源码：

```bash
pnpm install
pnpm typecheck
pnpm build
pnpm bundle:check

rm -rf /path/to/ikuaiview/dist
cp -a dist/. /path/to/ikuaiview/dist/
cd /path/to/ikuaiview
docker-compose up -d --build ikuaiview
```

---

## 🤝 贡献

欢迎 Issue / PR。提交前请确认：

1. ✅ 不含真实 `.env`、密码、私有资产
2. ✅ `docker-compose config` 可通过
3. ✅ 文档中的首次部署步骤可在干净目录复现

---

## 📄 License

[MIT](./LICENSE)

第三方镜像与依赖请同时遵守其各自许可证。

---

## 🙏 致谢

- 实时采集：社区镜像 `jakes/ikuai-exporter`
- 历史时序：[Prometheus](https://prometheus.io/)
- 前端框架：Vue 3 生态

网关对接、数据契约、信息架构与移动端适配由本项目独立实现与维护。

---
---

# 🌐 English

<p align="center">
  <strong>Read-only LAN dashboard for iKuai routers</strong><br>
  <code>ikuai-exporter + Prometheus + Web UI → one-shot Docker Compose</code>
</p>

## ✨ Features

- 🖥️ System status: CPU / memory / uptime / firmware / online clients
- 🌐 WAN / PPPoE: public IP, gateway, WAN DNS, link state, dial duration
- 📈 Live rates + Prometheus 1h / 24h history
- 📦 Monthly/total usage and connection counters
- 🧩 DHCP, port forwards, four TCP latency probes
- 📱 Sortable online client table
- 🎨 System / dark / light themes
- 🔒 Read-only — never writes router config
- 🐳 Full stack Compose: exporter + Prometheus + board on **:3000**

## 🏗️ Architecture

```text
iKuai (read-only API)
   ├─ jakes/ikuai-exporter (:9090 metrics)
   ├─ prom/prometheus (WAN history)
   └─ iKuai API (PPPoE / DHCP / DNAT)
            └─ iKuaiView gateway + UI (:3000)
```

## 🚀 Quick start

```bash
git clone https://github.com/lzylipu/ikuaiview.git
cd ikuaiview
sh scripts/bootstrap.sh
# edit .env with read-only iKuai credentials
docker-compose pull
docker-compose up -d
# open http://<host>:3000
```

Minimum `.env`:

```env
IKUAI_URL=http://your-ikuai-host
IKUAI_USERNAME=readonly-user
IKUAI_PASSWORD=readonly-password
```

Local build:

```bash
docker-compose up -d --build
```

## ⚙️ Key environment variables

| Variable | Required | Default | Description |
|:---------|:--------:|:--------|:------------|
| `IKUAI_URL` | yes | — | iKuai base URL |
| `IKUAI_USERNAME` | yes | — | read-only user |
| `IKUAI_PASSWORD` | yes | — | read-only password |
| `IKUAIVIEW_IMAGE` | no | `lzylipu/ikuaiview:latest` | board image |
| `IKUAIVIEW_PORT` | no | `3000` | host port for UI |
| `IKUAI_EXPORTER_URL` | no | `http://ikuai-exporter:9090` | exporter URL inside compose |
| `PROMETHEUS_URL` | no | `http://prometheus:9090` | Prometheus URL inside compose |

## 📡 Data sources

| UI data | Source |
|:--------|:-------|
| Live system / client metrics | `ikuai-exporter` |
| WAN history chart | Prometheus |
| PPPoE / DHCP / DNAT / monthly totals | iKuai read-only API |
| Latency | TCP connect RTT from board container |

## 🧯 Troubleshooting

| Symptom | Fix |
|:--------|:----|
| UI stuck at 0 / — | wait 10–15s, hard refresh |
| exporter unhealthy | check `.env` credentials |
| empty history | ensure scrape target `ikuai-exporter:9090` |
| containers cannot talk | use compose service DNS names |
| GHCR pull fails | `docker-compose up -d --build` |

## 🔐 Security

- Expose `:3000` only on trusted LAN / VPN / reverse proxy
- Use a dedicated read-only iKuai account
- Never commit real `.env`

## 📄 License

[MIT](./LICENSE)
