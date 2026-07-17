#!/usr/bin/env sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
cd "$ROOT"

if [ ! -f .env ]; then
  cp .env.example .env
  echo "✅ Created .env from .env.example — edit IKUAI_URL / USERNAME / PASSWORD"
else
  echo "ℹ️  .env already exists"
fi

mkdir -p prometheus prometheus-data data

if [ ! -f prometheus/prometheus.yml ]; then
  cat > prometheus/prometheus.yml <<'EOF'
# Prometheus 抓取配置（官方模板）
# 目标使用 Compose 服务名 + 容器端口 9090
# 不要写成宿主机映射端口（如 9191）
#
# jakes/ikuai-exporter 在每次 /metrics 时实时回源爱快 API。
# 因此 scrape_interval 过短会放大登录/调用频率；推荐 30~60s。

global:
  scrape_interval: 30s
  evaluation_interval: 30s

scrape_configs:
  - job_name: ikuai
    scrape_interval: 30s
    static_configs:
      - targets:
          - ikuai-exporter:9090
EOF
  echo "✅ Created prometheus/prometheus.yml"
else
  echo "ℹ️  prometheus/prometheus.yml already exists"
fi

# data 目录给默认 root 用户写 SQLite；一般 mkdir 即可
chmod -R a+rwX data prometheus-data 2>/dev/null || true

echo
echo "Next:"
echo "  1) edit .env"
echo "  2) docker-compose pull"
echo "  3) docker-compose up -d"
echo "  4) open http://<host>:3000"
echo
echo "Ports: board=3000  exporter=9191  prometheus=9192"
echo "Note: prometheus.yml 默认 30s，一般无需再改"
