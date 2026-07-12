#!/usr/bin/env python3
# -*- coding: utf-8 -*-
import os
import re
import time
import json
import threading
import urllib.parse
import urllib.request
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from collections import deque

# ── 配置 ─────────────────────────────────────────────────────────────
EXPORTER_URL   = os.environ.get("IKUAI_EXPORTER_URL", "http://10.10.0.2:9191")
PROMETHEUS_URL = os.environ.get("PROMETHEUS_URL",     "http://10.10.0.2:9192")
PORT           = int(os.environ.get("IKUAI_PORT", "9193"))
SYNC_INTERVAL  = 2.0   # 轮询和推送间隔
ASSET_DIR      = os.path.dirname(os.path.abspath(__file__))

# 内存保留最新 60 个历史点 (2 分钟，仅作为 SSE 流的平滑填充，核心长时线查 Prometheus)
history_lock = threading.Lock()
traffic_history = deque(maxlen=60)  # 元素格式: {"time": ts, "down": KB/s, "up": KB/s}

def fetch_exporter_metrics():
    """抓取 ikuai-exporter 的 /metrics 并解析"""
    try:
        req = urllib.request.Request(f"{EXPORTER_URL}/metrics", headers={"User-Agent": "iKuai-Monitor-Gateway"})
        with urllib.request.urlopen(req, timeout=5) as response:
            content = response.read().decode('utf-8')
    except Exception as e:
        return {"error": f"Failed to fetch exporter metrics: {str(e)}"}

    data = {
        "cpu_usage": 0.0,
        "mem_usage_pct": 0.0,
        "mem_total_mb": 0.0,
        "mem_used_mb": 0.0,
        "device_count": 0,
        "devices": [],
        "interfaces": [],
        "wan_speed": {"down": 0.0, "up": 0.0},
        "lan_speed": {"down": 0.0, "up": 0.0},
        "up_status": {},
        "uptime": 0,
        "version": "Unknown"
    }

    # 解析行
    cpu_cores = []
    mem_used = 0
    mem_total = 0
    devices_map = {} # ip -> dev_info
    
    for line in content.splitlines():
        if line.startswith("#") or not line.strip():
            continue
        
        # 简单空格切分
        parts = line.strip().split(" ")
        if len(parts) < 2:
            continue
        val_str = parts[-1]
        metric_part = " ".join(parts[:-1])
        
        try:
            val = float(val_str)
        except ValueError:
            continue

        # 解析 CPU
        if metric_part.startswith("ikuai_cpu_usage_ratio"):
            cpu_cores.append(val)
        
        # 解析 内存
        elif metric_part.startswith("ikuai_memory_size_bytes"):
            mem_total = val / 1024 / 1024 # MB
        elif metric_part.startswith("ikuai_memory_usage_bytes"):
            mem_used = val / 1024 / 1024 # MB
        
        # 解析 设备数
        elif metric_part.startswith("ikuai_device_count"):
            data["device_count"] = int(val)
            
        # 解析 Uptime
        elif metric_part.startswith("ikuai_uptime{id=\"host\"}"):
            data["uptime"] = int(val)

        # 解析 版本
        elif metric_part.startswith("ikuai_version"):
            # 获取 version="4.0.303"
            m = re.search(r'verstring="([^"]+)"', metric_part)
            if m:
                data["version"] = m.group(1)

        # 解析 接口信息
        elif metric_part.startswith("ikuai_iface_info"):
            labels = dict(re.findall(r'(\w+)="([^"]*)"', metric_part))
            data["interfaces"].append({
                "name": labels.get("interface", ""),
                "ip": labels.get("ip_addr", ""),
                "type": labels.get("internet", "LAN"),
                "status": "UP"
            })

        # 解析 接口/设备速率和连接数
        elif metric_part.startswith("ikuai_network_recv_kbytes_per_second"):
            m = re.search(r'id="([^"]+)"', metric_part)
            if m:
                target_id = m.group(1)
                if target_id.startswith("device/"):
                    ip = target_id.replace("device/", "")
                    if ip not in devices_map: devices_map[ip] = {}
                    devices_map[ip]["down_rate"] = val
                elif target_id == "iface/wan1":
                    data["wan_speed"]["down"] = val
                elif target_id == "iface/lan1":
                    data["lan_speed"]["down"] = val
                    
        elif metric_part.startswith("ikuai_network_send_kbytes_per_second"):
            m = re.search(r'id="([^"]+)"', metric_part)
            if m:
                target_id = m.group(1)
                if target_id.startswith("device/"):
                    ip = target_id.replace("device/", "")
                    if ip not in devices_map: devices_map[ip] = {}
                    devices_map[ip]["up_rate"] = val
                elif target_id == "iface/wan1":
                    data["wan_speed"]["up"] = val
                elif target_id == "iface/lan1":
                    data["lan_speed"]["up"] = val

        elif metric_part.startswith("ikuai_network_conn_count"):
            m = re.search(r'id="([^"]+)"', metric_part)
            if m:
                target_id = m.group(1)
                if target_id.startswith("device/"):
                    ip = target_id.replace("device/", "")
                    if ip not in devices_map: devices_map[ip] = {}
                    devices_map[ip]["conns"] = int(val)

        # 设备基础属性
        elif metric_part.startswith("ikuai_device_info"):
            labels = dict(re.findall(r'(\w+)="([^"]*)"', metric_part))
            ip = labels.get("ip_addr", "")
            if ip:
                if ip not in devices_map: devices_map[ip] = {}
                devices_map[ip]["ip"] = ip
                devices_map[ip]["mac"] = labels.get("mac", "")
                hostname = labels.get("hostname", "")
                # URL 解码 hostname
                devices_map[ip]["name"] = urllib.parse.unquote(hostname) if hostname else labels.get("comment", "") or ip

    # 填充 CPU 与 内存
    if cpu_cores:
        data["cpu_usage"] = sum(cpu_cores) / len(cpu_cores)
    if mem_total > 0:
        data["mem_total_mb"] = round(mem_total, 2)
        data["mem_used_mb"] = round(mem_used, 2)
        data["mem_usage_pct"] = round((mem_used / mem_total) * 100, 2)

    # 组合设备列表
    devices_list = []
    for ip, dev in devices_map.items():
        if "ip" not in dev:
            dev["ip"] = ip
        dev["name"] = dev.get("name", ip)
        dev["mac"] = dev.get("mac", "")
        dev["down_rate"] = dev.get("down_rate", 0.0)
        dev["up_rate"] = dev.get("up_rate", 0.0)
        dev["conns"] = dev.get("conns", 0)
        devices_list.append(dev)
    
    # 按照下载速率降序排列
    devices_list.sort(key=lambda x: x["down_rate"], reverse=True)
    data["devices"] = devices_list

    return data

# ── 历史记录后台同步 ──────────────────────────────────────────────────
def history_worker():
    while True:
        try:
            snap = fetch_exporter_metrics()
            if "error" not in snap:
                ts = int(time.time())
                with history_lock:
                    traffic_history.append({
                        "time": ts,
                        "down": snap["wan_speed"]["down"],
                        "up": snap["wan_speed"]["up"]
                    })
        except Exception:
            pass
        time.sleep(SYNC_INTERVAL)

threading.Thread(target=history_worker, daemon=True).start()

# ── Web 服务请求处理器 ─────────────────────────────────────────────────
class WebHandler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        return

    def do_GET(self):
        parsed_url = urllib.parse.urlparse(self.path)
        path = parsed_url.path
        query = urllib.parse.parse_qs(parsed_url.query)

        # 1. 静态网页
        if path == "/":
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.end_headers()
            index_path = os.path.join(ASSET_DIR, "index.html")
            if os.path.exists(index_path):
                with open(index_path, "rb") as f:
                    self.wfile.write(f.read())
            else:
                self.wfile.write(b"index.html not found.")
            return

        # 2. 获取一次快照 API
        if path == "/api/snapshot":
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            snap = fetch_exporter_metrics()
            self.wfile.write(json.dumps(snap).encode('utf-8'))
            return

        # 3. 代理/转发 Prometheus 历史范围查询 API (适配 ECharts 曲线)
        if path == "/api/range":
            metric_type = query.get("metric", ["wan_down"])[0]
            duration = int(query.get("duration", ["900"])[0])
            step = int(query.get("step", ["15"])[0])

            end_time = int(time.time())
            start_time = end_time - duration

            promql = ""
            if metric_type == "wan_down":
                promql = 'ikuai_network_recv_kbytes_per_second{id="iface/wan1"}'
            elif metric_type == "wan_up":
                promql = 'ikuai_network_send_kbytes_per_second{id="iface/wan1"}'
            elif metric_type == "cpu":
                promql = 'avg(ikuai_cpu_usage_ratio)'
            elif metric_type == "mem":
                promql = '(ikuai_memory_usage_bytes / ikuai_memory_size_bytes) * 100'
            else:
                promql = 'ikuai_network_recv_kbytes_per_second{id="iface/wan1"}'

            prom_url = f"{PROMETHEUS_URL}/api/v1/query_range?query={urllib.parse.quote(promql)}&start={start_time}&end={end_time}&step={step}"
            
            try:
                req = urllib.request.Request(prom_url, headers={"User-Agent": "iKuai-Monitor-Gateway"})
                with urllib.request.urlopen(req, timeout=5) as response:
                    prom_res = json.loads(response.read().decode('utf-8'))
                
                points = []
                if prom_res.get("status") == "success":
                    result = prom_res.get("data", {}).get("result", [])
                    if result:
                        for item in result[0].get("values", []):
                            points.append({
                                "time": int(item[0]),
                                "value": round(float(item[1]), 2)
                            })
                
                self.send_response(200)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.send_header("Access-Control-Allow-Origin", "*")
                self.end_headers()
                self.wfile.write(json.dumps({"status": "success", "points": points}).encode('utf-8'))
            except Exception as e:
                self.send_response(500)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.send_header("Access-Control-Allow-Origin", "*")
                self.end_headers()
                self.wfile.write(json.dumps({"status": "error", "message": str(e)}).encode('utf-8'))
            return

        # 4. SSE 流式实时推送
        if path == "/events":
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.send_header("Cache-Control", "no-cache")
            self.send_header("Connection", "keep-alive")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()

            while True:
                try:
                    snap = fetch_exporter_metrics()
                    with history_lock:
                        snap["history"] = list(traffic_history)
                    
                    event_data = f"data: {json.dumps(snap)}\n\n"
                    self.wfile.write(event_data.encode('utf-8'))
                    self.wfile.flush()
                except Exception:
                    break
                time.sleep(SYNC_INTERVAL)
            return

        self.send_response(404)
        self.end_headers()
        self.wfile.write(b"Not Found")

def run():
    print(f"Starting iKuai Monitor Gateway on port {PORT}...")
    server = ThreadingHTTPServer(('0.0.0.0', PORT), WebHandler)
    server.serve_forever()

if __name__ == "__main__":
    run()
