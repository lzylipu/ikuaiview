# iKuaiView

<p align="center">
  <img src="dist/ikuaiview-logo.png" alt="iKuaiView logo" width="128" height="128" />
</p>

<p align="center"><b>iKuai 只读局域网监控看板</b></p>

[English](./README.en.md) | 简体中文

**iKuaiView** 是一个面向 [iKuai](https://www.ikuai8.com/) 路由器的**只读局域网监控看板**。  
它把实时状态、WAN/PPPoE 链路、历史吞吐、网络服务摘要和在线终端，集中到一个可 Docker 一键部署的 Web 面板中。

> 设计目标：本地部署、配置简单、数据真实、界面清晰。  
> 本项目**不修改**路由器配置，只消费只读 API 与 metrics。

---

## 功能特性

- **系统概览**：CPU、内存、运行时长、固件版本、在线终端数
- **WAN / PPPoE**：公网 IP、网关、WAN DNS、线路状态、拨号时长、连接时间
- **流量视图**：本月/累计用量、实时上下行、总连接 / TCP / UDP / ICMP
- **历史曲线**：对接 Prometheus，支持 1 小时 / 24 小时 WAN 吞吐
- **网络服务**：DHCP 范围与剩余地址、端口转发、四路 TCP 延迟探测
- **在线终端表**：名称 / IP / MAC / 实时速率 / 累计流量 / 连接数，支持排序
- **主题**：跟随系统 / 暗色 / 亮色
- **移动端适配**：保留系统 → 网络 → 速率 → 终端的阅读顺序

---

## 架构

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

| 组件 | 镜像 / 进程 | 作用 |
| --- | --- | --- |
| 采集器 | `jakes/ikuai-exporter` | 实时 metrics：系统、接口、终端 |
| 时序库 | `prom/prometheus` | WAN 历史曲线 |
| 看板 | 本仓库 `ikuaiview` | Python 网关 + 前端静态资源 |

---

## 快速开始

### 1. 环境要求

- Docker Engine
- Docker Compose v1（`docker-compose`）或兼容的 Compose 插件
- 可访问的 iKuai Web/API 地址
- 一个 **iKuai 只读账号**（推荐单独创建 API 用户，不要用超管）

### 2. 获取代码

```bash
git clone https://github.com/lzylipu/ikuaiview.git
cd ikuaiview
```

### 3. 准备配置与模板

```bash
# 1) 环境变量（必做）
cp .env.example .env
# 用编辑器填写真实值
# nano .env   或   vim .env

# 2) Prometheus 配置模板（仓库已提供；若缺失可重建）
mkdir -p prometheus prometheus-data
test -f prometheus/prometheus.yml || cat > prometheus/prometheus.yml <<'EOF'
global:
  scrape_interval: 15s
  evaluation_interval: 15s

scrape_configs:
  - job_name: ikuai
    static_configs:
      - targets:
          - ikuai-exporter:9090
EOF

# 3) 数据目录权限（部分 NAS / bind mount 环境需要）
chmod -R a+rwX prometheus-data || true
```

`.env` 最少需要：

```env
IKUAI_URL=http://你的爱快地址
IKUAI_USERNAME=只读账号
IKUAI_PASSWORD=只读密码
```

### 4. 一键启动

```bash
docker-compose up -d --build
```

启动后访问：

```text
http://<主机IP>:3000
```

默认端口映射：

| 服务 | 主机端口 | 容器端口 | 说明 |
| --- | --- | --- | --- |
| iKuaiView | **3000** | 3000 | 看板入口 |
| ikuai-exporter | 9191 | 9090 | metrics（可选暴露） |
| Prometheus | 9090 | 9090 | 时序库 UI（可选暴露） |

可在 `.env` 中通过 `IKUAIVIEW_PORT` / `IKUAI_EXPORTER_PORT` / `PROMETHEUS_PORT` 修改主机端口。

### 5. 验证

```bash
# 容器状态
docker-compose ps

# 看板
curl -fsS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3000/

# exporter metrics
curl -fsS http://127.0.0.1:9191/metrics | head

# Prometheus targets（应看到 ikuai-exporter UP）
curl -fsS http://127.0.0.1:9090/api/v1/targets | head
```

浏览器打开看板后，**等待 10–15 秒** 让 WebSocket 首包到达；初始的 `—` / `0` 属于加载态，不是最终结果。

---

## 配置说明

### 环境变量

| 变量 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `IKUAI_URL` | 是 | — | iKuai Web/API 根地址，如 `http://192.168.x.x` |
| `IKUAI_USERNAME` | 是 | — | 只读 API 用户名 |
| `IKUAI_PASSWORD` | 是 | — | 只读 API 密码 |
| `IKUAI_MODULES` | 否 | `sysStat,lanDevice,interfaceInfo` | exporter 采集模块 |
| `IKUAI_INSECURE_SKIP` | 否 | `true` | 跳过 TLS 校验（内网常见） |
| `IKUAI_LEVEL` | 否 | `info` | exporter 日志级别 |
| `IKUAI_EXPORTER_URL` | 否 | `http://ikuai-exporter:9090` | 看板访问 exporter 的地址 |
| `PROMETHEUS_URL` | 否 | `http://prometheus:9090` | 看板访问 Prometheus 的地址 |
| `IKUAI_PORT` | 否 | `3000` | 看板容器监听端口 |
| `IKUAIVIEW_PORT` | 否 | `3000` | 看板主机映射端口 |
| `IKUAI_EXPORTER_PORT` | 否 | `9191` | exporter 主机映射端口 |
| `PROMETHEUS_PORT` | 否 | `9090` | Prometheus 主机映射端口 |
| `PROMETHEUS_RETENTION` | 否 | `30d` | Prometheus 数据保留时长 |

> Compose 网络内请优先使用服务名 `ikuai-exporter` / `prometheus`，不要写宿主机映射 IP，避免容器互访失败。

### Prometheus 模板说明

首次部署必须存在：

```text
./prometheus/prometheus.yml
```

仓库已附带可用模板，目标为：

```yaml
targets:
  - ikuai-exporter:9090
```

这是容器内服务名 + **容器端口 9090**。  
如果你改了服务名或网络，需要同步修改该文件后执行：

```bash
docker-compose up -d prometheus
```

---

## 常用运维命令

```bash
# 查看日志
docker-compose logs -f ikuaiview
docker-compose logs -f ikuai-exporter
docker-compose logs -f prometheus

# 重启看板
docker-compose restart ikuaiview

# 重新构建并启动
docker-compose up -d --build

# 停止
docker-compose down

# 停止并删除数据卷/目录前请三思
# rm -rf prometheus-data
```

---

## 数据来源与准确性

| 面板内容 | 数据源 |
| --- | --- |
| CPU / 内存 / 实时速率 / 终端速率 / 连接数 | `ikuai-exporter` `/metrics` |
| WAN 1 小时 / 24 小时曲线 | Prometheus |
| PPPoE、WAN DNS、DHCP、端口转发、本月/接口累计 | iKuai 只读 API |
| 终端显示名 | 优先 DHCP 静态分配备注（按 IP） |
| 延迟探测 | 看板容器本地 **TCP connect RTT**（不是 ICMP Ping） |

说明：

1. 使用 OpenClash / Fake-IP 时，GitHub、YouTube 等可能解析到 `198.18.0.0/15`，亚毫秒延迟只代表本地代理入口。
2. 设备名称按 **IP** 对齐 DHCP 静态分配；旁路由场景下不要依赖共享 MAC 反查。
3. 本项目不会调用 iKuai 写接口。

---

## 安全建议

- 仅在受控局域网、VPN 或反向代理后暴露 `:3000`
- 为看板单独创建 **只读** iKuai 账号
- **永远不要** 把真实 `.env` 提交到 Git
- 不在截图/Issue 中粘贴内网资产、密码、公网 IP 明细（如有合规要求）

仓库已忽略：

```text
.env
prometheus-data/
```

---

## 目录结构

```text
ikuaiview/
├── README.md                 # 中文文档
├── README.en.md              # English docs
├── LICENSE
├── Dockerfile
├── docker-compose.yml        # 完整三件套
├── .env.example              # 环境变量模板
├── .gitignore
├── gateway.py                # Python 网关（标准库）
├── prometheus/
│   └── prometheus.yml        # Prometheus 首次启动模板
└── dist/                     # 预构建前端静态资源
```

运行时会自动使用：

```text
prometheus-data/              # Prometheus TSDB（本地目录，已 gitignore）
```

---

## 故障排查

| 现象 | 可能原因 | 处理 |
| --- | --- | --- |
| 页面打开全是 0 / — | WebSocket 尚未首包 | 等待 10–15 秒后刷新 |
| exporter 起不来 | iKuai 账号/地址错误 | 检查 `.env` 与 `docker-compose logs ikuai-exporter` |
| 历史曲线空白 | Prometheus 未抓到 target | 检查 `prometheus/prometheus.yml` 是否指向 `ikuai-exporter:9090` |
| Prometheus 启动 panic / 无写权限 | 数据目录权限 | `user: root` 已在 compose 中；检查 `prometheus-data` 可写 |
| 容器间连不通 | 写了宿主机映射 IP | 改回服务名 URL |
| 终端名称不对 | 未配置 DHCP 静态分配备注 | 在爱快「DHCP 静态分配」按 IP 写备注名 |

---

## 开发与二次构建（可选）

运行时**不需要** Node.js；仓库已包含 `dist/`。  
若你维护前端源码并重新构建：

```bash
# 在前端工程目录
pnpm install
pnpm typecheck
pnpm build
pnpm bundle:check

# 将产物覆盖到本仓库 dist/
rm -rf /path/to/ikuaiview/dist
cp -a dist/. /path/to/ikuaiview/dist/

cd /path/to/ikuaiview
docker-compose up -d --build ikuaiview
```

---

## 致谢

- 前端视觉语言参考了开源项目 [RouterView](https://github.com/unDefFtr/RouterView) 的布局与交互思路
- 实时采集依赖社区镜像 [`jakes/ikuai-exporter`](https://hub.docker.com/)
- 历史曲线依赖 [Prometheus](https://prometheus.io/)

iKuaiView 的网关对接、数据契约、面板信息架构与移动端适配由本项目独立实现与维护。

---

## License

见 [LICENSE](./LICENSE)。  
使用第三方镜像与上游前端设计时，请同时遵守其各自许可证。

---

## 贡献

Issue / PR 欢迎。提交前请确认：

1. 不包含真实 `.env`、内网资产表、密码
2. `docker-compose config` 可通过
3. 文档中的首次部署步骤可在干净目录复现