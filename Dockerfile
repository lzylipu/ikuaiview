FROM python:3.13-alpine

WORKDIR /app

# Gateway + prebuilt static dashboard (no frontend toolchain required at runtime)
COPY gateway.py .
COPY dist ./dist

RUN chmod +x gateway.py

ENV IKUAI_PORT=3000
EXPOSE 3000

ENTRYPOINT ["./gateway.py"]
