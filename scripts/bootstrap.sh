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

mkdir -p prometheus prometheus-data

if [ ! -f prometheus/prometheus.yml ]; then
  cat > prometheus/prometheus.yml <<'EOF'
global:
  scrape_interval: 15s
  evaluation_interval: 15s

scrape_configs:
  - job_name: ikuai
    static_configs:
      - targets:
          - ikuai-exporter:9090
EOF
  echo "✅ Created prometheus/prometheus.yml"
else
  echo "ℹ️  prometheus/prometheus.yml already exists"
fi

chmod -R a+rwX prometheus-data 2>/dev/null || true
echo
echo "Next:"
echo "  1) edit .env"
echo "  2) docker-compose pull"
echo "  3) docker-compose up -d"
echo "  4) open http://<host>:3000"
echo
echo "Ports: board=3000  exporter=9191  prometheus=9192"
