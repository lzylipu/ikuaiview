# iKuaiView

一个只读、局域网优先的 iKuai 网络监控看板。项目复用 RouterView 的视觉语言，但数据直接来自现有的 `ikuai-exporter`、Prometheus 和 iKuai 只读 API。

## 架构

```text
iKuai router (read-only API)
         │
         ├── ikuai-exporter ──实时指标──┐
         └── Prometheus ──历史 WAN 曲线─┼── iKuaiView gateway :9193
                                        └── Vue dashboard / WebSocket
```

- **ikuai-exporter**：实时 CPU、内存、WAN 速率、在线终端、各终端累计流量和连接数。
- **Prometheus**：WAN 近 1 小时 / 24 小时上下行历史曲线。
- **iKuai API**：PPPoE 信息、WAN DNS、DHCP、端口映射、原生接口累计流量和静态 DHCP 备注。
- **iKuaiView**：Python 标准库网关与 Vue 静态面板；没有登录、没有写路由器配置的能力。

## 面板内容

- 两列四区桌面布局：系统/WAN、网络服务与延迟、上下行速率、在线终端设备。
- PPPoE 公网 IP、网关、WAN DNS、线路状态、拨号时长和连接时间。
- DHCP 范围与可用地址、DNAT 端口转发和四个 TCP connect 延迟探针。
- 可排序的在线终端表：名称、IP、MAC、实时上下行、累计上下行、连接数。
- 暗色 / 亮色 / 跟随系统三态主题；品牌图标同时用于顶栏与 favicon。

> 延迟探针为 gateway 容器发出的 TCP connect RTT，不是 ICMP Ping。使用 Fake-IP/OpenClash 时，部分站点的低延迟仅代表本地代理入口。

## 快速部署

### 前置条件

- Docker Compose v1（`docker-compose`）
- 可访问的 iKuai Web API
- 推荐同一 Compose 网络内运行 `ikuai-exporter` 与 Prometheus；本 Compose 已使用服务名互连。

### 1. 配置环境变量

```bash
cp .env.example .env
# 编辑 .env，填入你的 iKuai URL、只读账号和密码
```

`.env` 已被 Git 忽略，切勿提交真实凭据。

### 2. 启动

```bash
docker-compose up -d --build
```

打开 `http://<host>:9193`。

## 环境变量

| 变量 | 必填 | 说明 |
| --- | --- | --- |
| `IKUAI_URL` | 是 | iKuai Web API 根地址，例如 `http://router.lan` |
| `IKUAI_USERNAME` | 是 | iKuai 只读 API 用户名 |
| `IKUAI_PASSWORD` | 是 | iKuai API 密码，仅写入本地 `.env` |
| `IKUAI_EXPORTER_URL` | 否 | exporter 地址；Compose 默认 `http://ikuai-exporter:9090` |
| `PROMETHEUS_URL` | 否 | Prometheus 地址；Compose 默认 `http://prometheus:9090` |
| `IKUAI_PORT` | 否 | 网关监听端口，默认 `9193` |

## 数据准确性

- 实时设备速率、累计字节与连接数直接来自 exporter，不依赖 Prometheus。
- 1 小时 / 24 小时 WAN 图表来自 Prometheus；若不需要历史曲线，可以按需删去 Prometheus 相关服务和 UI 范围。
- 设备名称优先以 iKuai DHCP 静态分配中的 IP→备注为准；MAC 优先级为 DHCP 静态分配、ARP、最后才是 exporter。
- “本月用量”读取 iKuai 原生接口监控数据；不以 Prometheus 不完整留存或绝对计数冒充。

## 开发与验证

前端源码不在运行容器内维护。构建产物为 `dist/`；更新前端后应执行：

```bash
pnpm typecheck
pnpm build
pnpm bundle:check
rm -rf /root/ikuaiview/dist && cp -a dist/. /root/ikuaiview/dist/
docker-compose up -d --build ikuaiview
```

提交前至少验证：类型检查、生产构建、bundle 预算、`http://localhost:9193` HTTP 200，以及浏览器等待 WebSocket 首包后的实际渲染。

## 安全边界

- 面板设计为**只读局域网看板**；请通过防火墙、反向代理或 VPN 控制访问范围。
- 不要将 `.env`、真实内网资产信息、路由器密码或 session cookie 提交到 GitHub。
- 网关使用 iKuai API 查询状态和配置摘要，不会调用写操作。

## License

本项目包含基于 RouterView 视觉布局改造的前端成果。发布和再分发前，请分别检查上游项目及所用依赖的许可条款。
