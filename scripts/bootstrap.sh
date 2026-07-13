#!/usr/bin/env sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
cd "$ROOT"

if [ ! -f .env ]; then
  cp .env.example .env
  echo "Created .env from .env.example — edit IKUAI_URL / USERNAME / PASSWORD before start."
else
  echo ".env already exists"
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
  echo "Created prometheus/prometheus.yml"
else
  echo "prometheus/prometheus.yml already exists"
fi

chmod -R a+rwX prometheus-data 2>/dev/null || true
echo
echo "Next:"
echo "  1) edit .env"
echo "  2) docker-compose up -d --build"
echo "  3) open http://<host>:3000"
