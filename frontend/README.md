# 🖥️ iKuaiView Frontend

Vue 3 + Vite + Pinia 源码。生产镜像默认使用仓库根目录预构建的 `dist/`（无需在 CI 装 Node）。

## 开发

```bash
cd frontend
pnpm install
pnpm dev
```

## 构建

```bash
pnpm build
# 产物在 frontend/dist，可复制到仓库根 dist/ 后重新 docker build
```

## 说明

- 品牌与文案均为 **iKuaiView / iKuai**
- 运行时数据由仓库根 `gateway.py` 提供（`/api/*` + `/ws`）
- 请勿提交 `.env` 或真实爱快密码
