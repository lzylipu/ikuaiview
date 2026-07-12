FROM python:3.13-alpine

WORKDIR /app

# 拷贝网关代码和前端资源
COPY gateway.py .
COPY dist ./dist

# 设置可执行权限
RUN chmod +x gateway.py

# 暴露网关端口
EXPOSE 9193

# 启动网关
ENTRYPOINT ["./gateway.py"]
