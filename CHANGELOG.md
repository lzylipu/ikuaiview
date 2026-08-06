# Changelog

## v0.37.2 — 2026-08-06

### UI（仅移动端）
- DNS tag：`@media ≤820` 一行两个、`gap:5px`、右顶格；桌面仍 v036 两行堆叠

## v0.37.1 — 2026-08-06

### 修复：公网/网关/DNS/总连接桌面+移动不显示
- **根因1**：`index.html` 入口 `index-RXv015.js` 与 `DashboardView` 静态 `import index-B2SGRze5.js` 形成双模块，Pinia store 分裂（WS 写入一份，卡片读另一份默认值）
- **根因2**：identity 字段 Vue 绑定在部分更新路径未落到 DOM
- **修复**：
  - 所有 chunk 统一 `import` 唯一入口 `index-RXv015.js`
  - `index-B2SGRze5.js` / `index-Bl7HeTzf.js` 改为 re-export 薄 shim（禁止再放完整副本）
  - snapshot/update 后 `_syncIdentityDom` 把公网/网关/DNS/总连接写入 DOM（不改布局）
- 测试机 `10.10.0.8:9190` 桌面 1440 + 移动 390 DOM 双验绿

## v037 — 2026-08-06

### 数据保真（不改页面布局）
- gateway：公网 IP / 本月用量 / 总连接 / 终端列表 **last-good**，exporter 半残或空值不再盖掉好数据
- 总连接优先 `ikuai_extra.connections`（TCP+UDP+ICMP），其次 host_conns / 设备 conns
- 前端 store：`ikuai_extra` 入正式类型与 dashboard store；snapshot/update **空值不覆盖**
- dist 双入口合并为单模块入口（见 v0.37.1）

## v036 — 2026-08-05

### UI
- DNS 两行显示、右顶格、不压字（`dns-list` 纵向 + `dns-tag` 右对齐）

## v035 — 2026-08-05

### UI
- WAN 卡片去掉无用「线路」状态块（桌面+移动）
- WAN 各行高度与行距统一（以 dial-grid 37px / gap 10px 为基准）
- 移动端 identity / usage / dial / metrics / connection 同级结构保持

### 数据逻辑
- 流量 live 点裁剪跟随 1H/24H（不再写死 6H）
- `/api/traffic` coverage.completeness 按真实有点跨度计算

### 仓库
- 附带 `frontend/` Vue3 源码，便于二次编译
- 清洗上游品牌文案残留，统一为 iKuaiView / iKuai
- 默认采集间隔 5s（可用环境变量调到 1s）
