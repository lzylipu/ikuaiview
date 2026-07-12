#!/usr/bin/env python3
# -*- coding: utf-8 -*-
import os
import re
import time
import json
import socket
import hashlib
import base64
import threading
import urllib.parse
import urllib.request
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler

# ── 配置 ─────────────────────────────────────────────────────────────
EXPORTER_URL   = os.environ.get("IKUAI_EXPORTER_URL", "http://10.10.0.2:9191")
PROMETHEUS_URL = os.environ.get("PROMETHEUS_URL",     "http://10.10.0.2:9192")
PORT           = int(os.environ.get("IKUAI_PORT", "9193"))
ASSET_DIR      = os.path.join(os.path.dirname(os.path.abspath(__file__)), "dist")

IKUAI_URL      = os.environ.get("IKUAI_URL", "http://10.10.0.1")
IKUAI_USER     = os.environ.get("IKUAI_USERNAME", "api")
IKUAI_PASS     = os.environ.get("IKUAI_PASSWORD", "")

# 静态设备别名表（作为兜底）
STATIC_ALIASES = {
    "10.10.0.1": "爱快主路由",
    "10.10.0.2": "群晖NAS (LZY)",
    "10.10.0.3": "新旁路由 (AGH/Clash)",
    "10.10.0.4": "备用老路由",
    "10.10.0.6": "备用旁路由",
    "10.10.0.7": "Docker-all宿主",
    "10.10.0.8": "LXC测试主机",
    "10.10.0.10": "我的PC电脑"
}

# 全局的设备备注和类型缓存
device_metadata_cache = {}
cache_lock = threading.Lock()

def ikuai_metadata_poller():
    """后台轮询爱快 API，同步真实设备名称(termname)及类型"""
    print("[Poller] Starting iKuai API metadata poller thread...")
    sess_key = None
    passwd_md5 = hashlib.md5(IKUAI_PASS.encode('utf-8')).hexdigest() if IKUAI_PASS else ""
    
    while True:
        if not IKUAI_PASS:
            print("[Poller] IKUAI_PASSWORD is not set. Metadata polling skipped.")
            time.sleep(10.0)
            continue

        try:
            # 1. 登录
            if not sess_key:
                login_payload = {"username": IKUAI_USER, "passwd": passwd_md5}
                req = urllib.request.Request(
                    f"{IKUAI_URL}/Action/login",
                    data=json.dumps(login_payload).encode('utf-8'),
                    headers={"Content-Type": "application/json", "User-Agent": "Mozilla/5.0"}
                )
                with urllib.request.urlopen(req, timeout=5) as res:
                    res_headers = res.info()
                    cookies = res_headers.get_all("Set-Cookie", []) or []
                    for c in cookies:
                        if "sess_key" in c:
                            parts = c.split(";")
                            for p in parts:
                                if p.strip().startswith("sess_key="):
                                    sess_key = p.strip().split("=")[1]
                                    break
            
            # 2. 查询在线设备
            if sess_key:
                dev_payload = {
                    "action": "show",
                    "func_name": "monitor_lanip",
                    "param": {
                        "TYPE": "data,total",
                        "limit": "0,1000"
                    }
                }
                req = urllib.request.Request(
                    f"{IKUAI_URL}/Action/call",
                    data=json.dumps(dev_payload).encode('utf-8'),
                    headers={
                        "Content-Type": "application/json",
                        "Cookie": f"sess_key={sess_key}",
                        "User-Agent": "Mozilla/5.0"
                    }
                )
                with urllib.request.urlopen(req, timeout=5) as res:
                    body = json.loads(res.read().decode('utf-8'))
                    if body.get("code") == 1008 or body.get("Result") == 10000:
                        sess_key = None
                        continue
                    
                    dev_list = body.get("results", {}).get("data", [])
                    new_cache = {}
                    for dev in dev_list:
                        mac = dev.get("mac", "").lower()
                        if mac:
                            new_cache[mac] = {
                                "termname": dev.get("termname", ""),
                                "comment": dev.get("comment", ""),
                                "hostname": dev.get("hostname", ""),
                                "vendor": dev.get("client_vendor", ""),
                                "client_type": dev.get("client_type", "")
                            }
                    
                    with cache_lock:
                        global device_metadata_cache
                        device_metadata_cache = new_cache
        except Exception as e:
            print("[Poller] Metadata sync failed:", e)
            sess_key = None  # 遇错清除 key 重新登录
            
        time.sleep(10.0)

# 启动轮询线程
poller_thread = threading.Thread(target=ikuai_metadata_poller, daemon=True)
poller_thread.start()

def fetch_exporter_metrics():
    try:
        req = urllib.request.Request(f"{EXPORTER_URL}/metrics", headers={"User-Agent": "iKuai-Monitor-Gateway"})
        with urllib.request.urlopen(req, timeout=3) as response:
            content = response.read().decode('utf-8')
    except Exception as e:
        return {"error": f"Failed to fetch exporter metrics: {str(e)}"}

    data = {
        "cpu_usage": 0.0,
        "mem_usage_pct": 0.0,
        "mem_total_bytes": 0.0,
        "mem_used_bytes": 0.0,
        "device_count": 0,
        "devices": [],
        "interfaces": [],
        "wan_speed": {"down": 0.0, "up": 0.0},
        "lan_speed": {"down": 0.0, "up": 0.0},
        "wan_ip": "—",
        "wan_proto": "PPPOE",
        "uptime": 0,
        "version": "Unknown"
    }

    cpu_cores = []
    mem_used = 0
    mem_total = 0
    devices_map = {}
    
    for line in content.splitlines():
        if line.startswith("#") or not line.strip():
            continue
        parts = line.strip().split(" ")
        if len(parts) < 2:
            continue
        val_str = parts[-1]
        metric_part = " ".join(parts[:-1])
        try:
            val = float(val_str)
        except ValueError:
            continue

        if metric_part.startswith("ikuai_cpu_usage_ratio"):
            cpu_cores.append(val)
        elif metric_part.startswith("ikuai_memory_size_bytes"):
            mem_total = val
        elif metric_part.startswith("ikuai_memory_usage_bytes"):
            mem_used = val
        elif metric_part.startswith("ikuai_device_count"):
            data["device_count"] = int(val)
        elif metric_part.startswith("ikuai_uptime{id=\"host\"}"):
            data["uptime"] = int(val)
        elif metric_part.startswith("ikuai_version"):
            m = re.search(r'verstring="([^"]+)"', metric_part)
            if m: data["version"] = m.group(1)
        elif metric_part.startswith("ikuai_iface_info"):
            labels = dict(re.findall(r'(\w+)="([^"]*)"', metric_part))
            if labels.get("internet") == "PPPOE" or "wan" in labels.get("interface", ""):
                data["wan_ip"] = labels.get("ip_addr", "—")
                data["wan_proto"] = labels.get("internet", "PPPOE")
            data["interfaces"].append({
                "name": labels.get("interface", ""),
                "ip": labels.get("ip_addr", ""),
                "type": labels.get("internet", "LAN"),
                "status": "UP"
            })
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
        elif metric_part.startswith("ikuai_device_info"):
            labels = dict(re.findall(r'(\w+)="([^"]*)"', metric_part))
            ip = labels.get("ip_addr", "")
            mac = labels.get("mac", "").lower()
            if ip:
                if ip not in devices_map: devices_map[ip] = {}
                devices_map[ip]["ip"] = ip
                devices_map[ip]["mac"] = mac
                
                # 从本地 API 缓存合并真实名称
                metadata = {}
                with cache_lock:
                    metadata = device_metadata_cache.get(mac, {})
                
                # 优先级：爱快改名 (termname) > 静态备注 (comment) > 客户端主机名 (hostname) > 静态硬编码别名
                name = metadata.get("termname") or metadata.get("comment") or metadata.get("hostname") or STATIC_ALIASES.get(ip) or ip
                name = urllib.parse.unquote(name) if name else ip
                devices_map[ip]["name"] = name
                
                # 映射设备图标类型
                dev_type = "desktop"
                vendor = metadata.get("vendor", "").lower()
                c_type = metadata.get("client_type", "").lower()
                term = name.lower()
                
                if "phone" in c_type or "ios" in c_type or "android" in c_type:
                    dev_type = "phone"
                elif "camera" in term or "摄像头" in term:
                    dev_type = "camera"
                elif "投影" in term or "电视" in term or "tv" in term:
                    dev_type = "media"
                elif "插座" in term or "空调" in term or "扫地机" in term or "xiaomi" in vendor:
                    dev_type = "iot"
                elif "proxmox" in vendor or "vmware" in vendor or "server" in term:
                    dev_type = "desktop"
                elif "zte" in vendor or "router" in term or "route" in term or "wrt" in term:
                    dev_type = "router"
                elif "switch" in term or "交换" in term:
                    dev_type = "switch"
                    
                devices_map[ip]["device_type"] = dev_type

    if cpu_cores:
        data["cpu_usage"] = sum(cpu_cores) / len(cpu_cores)
    if mem_total > 0:
        data["mem_total_bytes"] = mem_total
        data["mem_used_bytes"] = mem_used
        data["mem_usage_pct"] = (mem_used / mem_total) * 100

    devices_list = []
    for ip, dev in devices_map.items():
        if "ip" not in dev: dev["ip"] = ip
        dev["name"] = dev.get("name", ip)
        dev["mac"] = dev.get("mac", "")
        dev["down_rate"] = dev.get("down_rate", 0.0)
        dev["up_rate"] = dev.get("up_rate", 0.0)
        dev["conns"] = dev.get("conns", 0)
        dev["device_type"] = dev.get("device_type", "desktop")
        devices_list.append(dev)
    
    # 彻底不进行排序，直接全量返回由 Vue 接管
    data["devices"] = devices_list
    return data

def make_snapshot_payload(data):
    """生成完美符合 RouterView 前端规范的 DashboardSnapshot 数据结构"""
    ts = time.strftime("%Y-%m-%dT%H:%M:%S.000Z", time.gmtime())
    
    devices = []
    for dev in data.get("devices", []):
        devices.append({
            "mac": dev["mac"],
            "hostname": dev["name"],
            "ip": dev["ip"],
            "device_type": dev["device_type"],
            "signal": None,
            "connected_duration": 3600,
            "dhcp_status": "bound",
            "dhcp_expires": None,
            "interface": "lan1",
            "arp_status": "reachable",
            "custom_name": None,
            "custom_type": None
        })

    payload = {
        "system": {
            "model": "iKuai Flow Control",
            "version": data.get("version", "4.0.x"),
            "uptime": f"{data.get('uptime', 0) // 3600}小时",
            "uptime_seconds": data.get("uptime", 0),
            "cpu_load": round(data.get("cpu_usage", 0.0) * 100, 1),
            "free_memory": int(data.get("mem_total_bytes", 0) - data.get("mem_used_bytes", 0)),
            "total_memory": int(data.get("mem_total_bytes", 0)),
            "total_hdd": 8589934592,
            "free_hdd": 4294967296,
            "architecture": "x86_64",
            "board_name": "PVE Soft Router"
        },
        "gateway": {
            "wan_interface": "wan1",
            "wan_ip": data.get("wan_ip", "—"),
            "gateway_ip": "10.10.0.1",
            "wan_online": True,
            "ip_allocations": len(devices),
            "wans": [
                {
                    "wan_name": "wan1",
                    "wan_ip": data.get("wan_ip", "—"),
                    "gateway_ip": "10.10.0.1",
                    "online": True,
                    "download_bps": int(data["wan_speed"]["down"]),
                    "upload_bps": int(data["wan_speed"]["up"]),
                    "is_primary": True
                }
            ]
        },
        "interfaces": {
            "ethernet_count": len(data.get("interfaces", [])),
            "wifi_count": 0,
            "connected_devices": len(devices),
            "wifi_online": False
        },
        "isp": {
            "name": data.get("wan_proto", "PPPOE"),
            "online": True,
            "monthly_usage_gb": 0,
            "download_bps": int(data["wan_speed"]["down"]),
            "upload_bps": int(data["wan_speed"]["up"]),
            "connection_count": sum(dev.get("conns", 0) for dev in data.get("devices", [])),
            "wans": [
                {
                    "wan_name": "wan1",
                    "name": data.get("wan_proto", "PPPOE"),
                    "online": True,
                    "download_bps": int(data["wan_speed"]["down"]),
                    "upload_bps": int(data["wan_speed"]["up"])
                }
            ]
        },
        "traffic": {
            "points": [
                {
                    "timestamp": ts,
                    "download_bps": int(data["wan_speed"]["down"]),
                    "upload_bps": int(data["wan_speed"]["up"])
                }
            ]
        },
        "latency_probes": [
            {"target": "Baidu DNS", "host": "110.242.68.3", "latency_ms": 12, "status": "good", "category": "dns"},
            {"target": "Ali DNS", "host": "223.5.5.5", "latency_ms": 15, "status": "good", "category": "dns"},
            {"target": "Cloudflare", "host": "1.1.1.1", "latency_ms": 48, "status": "moderate", "category": "cdn"}
        ],
        "wifi": {
            "interface_count": 0,
            "client_count": 0,
            "packet_loss_pct": 0.0,
            "retransmit_pct": 0.0,
            "devices": devices
        },
        "stability": {
            "online_rate": 100.0,
            "segments": [
                {"color": "#22c55e", "value": 30, "label": "100%"}
            ],
            "window_minutes": 30
        },
        "interface_statuses": [
            {
                "name": "lan1",
                "type": "ether",
                "running": True,
                "rx_bps": int(data["lan_speed"]["down"]),
                "tx_bps": int(data["lan_speed"]["up"]),
                "is_wan": False
            },
            {
                "name": "wan1",
                "type": "ether",
                "running": True,
                "rx_bps": int(data["wan_speed"]["down"]),
                "tx_bps": int(data["wan_speed"]["up"]),
                "is_wan": True,
                "wan_name": "wan1"
            }
        ],
        "timestamp": ts,
        "wans": [
            {
                "wan_name": "wan1",
                "wan_ip": data.get("wan_ip", "—"),
                "gateway_ip": "10.10.0.1",
                "online": True,
                "download_bps": int(data["wan_speed"]["down"]),
                "upload_bps": int(data["wan_speed"]["up"]),
                "is_primary": True
            }
        ],
        "wans_isp": [
            {
                "wan_name": "wan1",
                "name": data.get("wan_proto", "PPPOE"),
                "online": True,
                "download_bps": int(data["wan_speed"]["down"]),
                "upload_bps": int(data["wan_speed"]["up"])
            }
        ],
        "wan_traffic_points": [
            {
                "timestamp": ts,
                "download_bps": int(data["wan_speed"]["down"]),
                "upload_bps": int(data["wan_speed"]["up"]),
                "wan_name": "wan1"
            }
        ]
    }
    return payload

def make_update_payload(data):
    ts = time.strftime("%Y-%m-%dT%H:%M:%S.000Z", time.gmtime())
    snap = make_snapshot_payload(data)
    return {
        "system": snap["system"],
        "gateway": snap["gateway"],
        "interfaces": snap["interfaces"],
        "isp": snap["isp"],
        "traffic": {
            "timestamp": ts,
            "download_bps": int(data["wan_speed"]["down"]),
            "upload_bps": int(data["wan_speed"]["up"])
        },
        "latency_probes": snap["latency_probes"],
        "wifi": snap["wifi"],
        "stability": snap["stability"],
        "interface_statuses": snap["interface_statuses"],
        "timestamp": ts,
        "wans": snap["wans"],
        "wans_isp": snap["wans_isp"],
        "wan_traffic_points": [
            {
                "timestamp": ts,
                "download_bps": int(data["wan_speed"]["down"]),
                "upload_bps": int(data["wan_speed"]["up"]),
                "wan_name": "wan1"
            }
        ]
    }

class WebHandler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        return

    def handle_websocket(self):
        key = self.headers.get("Sec-WebSocket-Key")
        guid = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"
        accept = base64.b64encode(hashlib.sha1((key + guid).encode('utf-8')).digest()).decode('utf-8')
        
        self.wfile.write(b"HTTP/1.1 101 Switching Protocols\r\n")
        self.wfile.write(b"Upgrade: websocket\r\n")
        self.wfile.write(b"Connection: Upgrade\r\n")
        self.wfile.write(f"Sec-WebSocket-Accept: {accept}\r\n\r\n".encode('utf-8'))
        
        conn = self.connection
        conn.setblocking(True)
        print("[WS] Connection upgraded successfully.")
        
        def send_frame(msg_type, data):
            envelope = {"type": msg_type, "data": data}
            payload = json.dumps(envelope).encode('utf-8')
            length = len(payload)
            frame = bytearray()
            frame.append(0x81)  # FIN=1, Opcode=1 (Text)
            if length < 126:
                frame.append(length)
            elif length < 65536:
                frame.append(126)
                frame.extend(length.to_bytes(2, byteorder='big'))
            else:
                frame.append(127)
                frame.extend(length.to_bytes(8, byteorder='big'))
            frame.extend(payload)
            conn.sendall(frame)

        try:
            # 1. 首次推送 snapshot
            metrics = fetch_exporter_metrics()
            if "error" not in metrics:
                send_frame("snapshot", make_snapshot_payload(metrics))
            
            # 2. 循环推送 update
            while True:
                time.sleep(2.0)
                metrics = fetch_exporter_metrics()
                if "error" not in metrics:
                    send_frame("update", make_update_payload(metrics))
        except Exception as e:
            print("[WS] Connection closed:", e)
        finally:
            conn.close()

    def do_GET(self):
        if self.headers.get("Upgrade", "").lower() == "websocket":
            self.handle_websocket()
            return

        parsed_url = urllib.parse.urlparse(self.path)
        path = parsed_url.path
        query = urllib.parse.parse_qs(parsed_url.query)

        # ── REST API ────────────────────────────────────────────────
        if path == "/api/health":
            body = json.dumps({"status": "ok", "version": "1.0.0"}).encode('utf-8')
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return

        if path == "/api/auth/status":
            body = json.dumps({"setup_required": False, "authenticated": True, "oidc": None}).encode('utf-8')
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return

        if path == "/api/auth/me":
            body = json.dumps({
                "username": "admin",
                "display_name": "管理员",
                "role": "admin",
                "session_kind": "local",
                "auth_method": "password",
                "provider_name": None,
                "capabilities": ["read", "configure", "manage_devices", "manage_sessions"]
            }).encode('utf-8')
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return

        if path == "/api/config/full" or path == "/api/config":
            body = json.dumps({
                "wizard_completed": True,
                "dns_probe_targets": [],
                "router_ip": "10.10.0.1"
            }).encode('utf-8')
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return

        if path == "/api/devices/overrides" or path == "/api/oui":
            body = json.dumps([]).encode('utf-8')
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return

        # 历史 Prometheus 时序代理
        if path == "/api/traffic-history":
            range_str = query.get("range", ["1H"])[0]
            duration = 3600
            if range_str == "5M": duration = 300
            elif range_str == "6H": duration = 21600
            elif range_str == "24H": duration = 86400

            end_time = int(time.time())
            start_time = end_time - duration
            step = max(5, duration // 120)

            promql_down = 'ikuai_network_recv_kbytes_per_second{id="iface/wan1"}'
            promql_up = 'ikuai_network_send_kbytes_per_second{id="iface/wan1"}'

            AMP = chr(38)
            url_down = f"{PROMETHEUS_URL}/api/v1/query_range?query={urllib.parse.quote(promql_down)}{AMP}start={start_time}{AMP}end={end_time}{AMP}step={step}"
            url_up = f"{PROMETHEUS_URL}/api/v1/query_range?query={urllib.parse.quote(promql_up)}{AMP}start={start_time}{AMP}end={end_time}{AMP}step={step}"

            points = []
            try:
                req = urllib.request.Request(url_down, headers={"User-Agent": "iKuai-Monitor-Gateway"})
                with urllib.request.urlopen(req, timeout=3) as res:
                    res_down = json.loads(res.read().decode('utf-8'))
                req = urllib.request.Request(url_up, headers={"User-Agent": "iKuai-Monitor-Gateway"})
                with urllib.request.urlopen(req, timeout=3) as res:
                    res_up = json.loads(res.read().decode('utf-8'))

                down_map = {}
                if res_down.get("status") == "success":
                    for item in res_down.get("data", {}).get("result", [{}])[0].get("values", []):
                        down_map[int(item[0])] = float(item[1])

                if res_up.get("status") == "success":
                    for item in res_up.get("data", {}).get("result", [{}])[0].get("values", []):
                        ts_val = int(item[0])
                        date_str = time.strftime("%Y-%m-%dT%H:%M:%S.000Z", time.gmtime(ts_val))
                        points.append({
                            "timestamp": date_str,
                            "download_bps": int(down_map.get(ts_val, 0.0)),
                            "upload_bps": int(float(item[1])),
                            "wan_name": "wan1"
                        })
            except Exception as e:
                print("Failed query range:", e)

            body = json.dumps({"points": points}).encode('utf-8')
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(body)
            return

        # ── 静态文件分发 & 路由兜底 ─────────────────────────────
        clean_path = path.lstrip('/')
        file_path = os.path.join(ASSET_DIR, clean_path)

        mime_types = {
            ".html": "text/html; charset=utf-8",
            ".css": "text/css; charset=utf-8",
            ".js": "application/javascript; charset=utf-8",
            ".json": "application/json",
            ".png": "image/png",
            ".jpg": "image/jpeg",
            ".svg": "image/svg+xml",
            ".ico": "image/x-icon",
            ".woff2": "font/woff2",
            ".woff": "font/woff",
            ".ttf": "font/ttf"
        }

        if not os.path.exists(file_path) or os.path.isdir(file_path):
            file_path = os.path.join(ASSET_DIR, "index.html")

        ext = os.path.splitext(file_path)[1]
        content_type = mime_types.get(ext, "application/octet-stream")

        try:
            with open(file_path, "rb") as f:
                content = f.read()
            self.send_response(200)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(content)))
            if ext in [".woff", ".woff2", ".ttf"]:
                self.send_header("Cache-Control", "max-age=31536000")
            self.end_headers()
            self.wfile.write(content)
        except Exception:
            self.send_response(404)
            self.end_headers()
            self.wfile.write(b"Not Found")

def run():
    print(f"Starting iKuai Advanced Web Gateway on port {PORT}...")
    server = ThreadingHTTPServer(('0.0.0.0', PORT), WebHandler)
    server.serve_forever()

if __name__ == "__main__":
    run()
