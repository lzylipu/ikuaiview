# Changelog

## v037 — 2026-08-06

### 数据保真（不改页面布局）
- gateway：公网 IP / 本月用量 / 总连接 / 终端列表 **last-good**，exporter 半残或空值不再盖掉好数据
- 总连接优先 `ikuai_extra.connections`（TCP+UDP+ICMP），其次 host_conns / 设备 conns
- 前端 store：`ikuai_extra` 入正式类型与 dashboard store；snapshot/update **空值不覆盖**
- dist 双入口 `index-RXv015` ≡ `index-B2SGRze5` 同步合并逻辑；孤儿 mobile 包同步兜底

# Changelog

## v036 — 2026-08-05

### UI
- DNS 两行显示、右顶格、不压字（`dns-list` 纵向 + `dns-tag` 右对齐）

v035 — 2026-08-05

### UI
- WAN 卡片去掉无用「线路」状态块（桌面+移动）
- WAN 各行高度与行距统一（以 dial-grid 37px / gap 10px 为基准）
- 移动端 identity / usage / dial / metrics / connection 同级结构保持

### 数据逻辑
- 流量 live 点裁剪跟随 1H/24H（不再写死 6H）
- `/api/traffic` coverage.completeness 按真实有点跨度计算
- index 热修双入口（`index-RXv015.js` ≡ `index-B2SGRze5.js`）保持一致

### 仓库
- 附带 `frontend/` Vue3 源码，便于二次编译
- 清洗上游品牌文案残留，统一为 iKuaiView / iKuai
- 默认采集间隔 5s（可用环境变量调到 1s）

