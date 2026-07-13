FROM python:3.13-alpine

LABEL org.opencontainers.image.title="iKuaiView" \
      org.opencontainers.image.description="Read-only iKuai LAN dashboard gateway + UI" \
      org.opencontainers.image.source="https://github.com/lzylipu/ikuaiview" \
      org.opencontainers.image.licenses="MIT"

WORKDIR /app

# Gateway + prebuilt static dashboard (no frontend toolchain required at runtime)
COPY gateway.py .
COPY dist ./dist

RUN chmod +x gateway.py \
 && adduser -D -H -u 10001 appuser \
 && chown -R appuser:appuser /app

USER appuser

ENV IKUAI_PORT=3000
EXPOSE 3000

ENTRYPOINT ["./gateway.py"]
