FROM python:3.14-alpine

LABEL org.opencontainers.image.title="iKuaiView" \
      org.opencontainers.image.description="Read-only iKuai LAN dashboard gateway + UI" \
      org.opencontainers.image.source="https://github.com/lzylipu/ikuaiview" \
      org.opencontainers.image.licenses="MIT"

WORKDIR /app

# Gateway + prebuilt static dashboard (no frontend toolchain required at runtime)
COPY gateway.py .
COPY dist ./dist

RUN chmod +x gateway.py \
 && mkdir -p /data

ENV IKUAI_PORT=3000 \
    TZ=Asia/Shanghai \
    IKUAIVIEW_DATA_DIR=/data
EXPOSE 3000

# 看板自身 /api/health 端点返 200 即视为健康；不依赖外部 iKuai/exporter
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:${IKUAI_PORT}/api/health',timeout=2).status==200 else 1)"

ENTRYPOINT ["./gateway.py"]
