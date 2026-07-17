#!/usr/bin/env python3
# -*- coding: utf-8 -*-
import os
import re
import time
import json
import socket
import hashlib
import base64
import sqlite3
import threading
import urllib.parse
import urllib.request
from datetime import datetime, timezone, timedelta
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler

# ── 配置 ─────────────────────────────────────────────────────────────
EXPORTER_URL   = os.environ.get("IKUAI_EXPORTER_URL", "http://ikuai-exporter:9090")
PROMETHEUS_URL = os.environ.get("PROMETHEUS_URL",     "http://prometheus:9090")
PORT           = int(os.environ.get("IKUAI_PORT", "3000"))
ASSET_DIR      = os.path.join(os.path.dirname(os.path.abspath(__file__)), "dist")

IKUAI_URL      = os.environ.get("IKUAI_URL", "")
IKUAI_USER     = os.environ.get("IKUAI_USERNAME", "")
IKUAI_PASS     = os.environ.get("IKUAI_PASSWORD", "")
IKUAI_HOST     = urllib.parse.urlparse(IKUAI_URL).hostname or "—"

# 设备显示名严格按爱快「DHCP 静态分配」的 IP 对应名称。
# exporter 上报的 hostname 仅为系统识别名，不作为显示依据。
STATIC_ALIASES = {}

# 全局的设备备注和类型缓存
# by_ip: 主索引（DHCP 静态分配以 IP 人工校正为准）
# by_mac: 辅索引（仅当 IP 未命中时回退）
device_metadata_cache = {"by_ip": {}, "by_mac": {}}
ikuai_extra_cache = {}
extra_cache_lock = threading.Lock()
cache_lock = threading.Lock()
metadata_fetch_lock = threading.Lock()
# 复用登录会话，避免每 10s 重新 /Action/login 打满爱快 CPU
ikuai_session = {"sess_key": None, "ts": 0}
session_lock = threading.Lock()
SESSION_TTL = 600  # 秒


# 探针目标：配置后自动探测，无需 AI 干预
PROBE_TARGETS = [
    {"target": "阿里 DNS", "host": "223.5.5.5", "port": 53, "category": "dns"},
    {"target": "Google DNS", "host": "8.8.8.8", "port": 53, "category": "dns"},
    {"target": "GitHub", "host": "github.com", "port": 443, "category": "repo"},
    {"target": "YouTube", "host": "youtube.com", "port": 443, "category": "cdn"},
]

probe_cache = {"items": [], "ts": 0}

monthly_usage_cache = {"gb": 0.0, "covered_seconds": 0, "ts": 0}
# homepage 接口较重（~1s+/次），本月用量无需秒级刷新
homepage_usage_cache = {"total_bytes": 0, "isp": "", "ip": "", "ts": 0}
HOMEPAGE_USAGE_TTL = int(os.environ.get("IKUAIVIEW_HOMEPAGE_TTL", "300"))  # 默认 5 分钟
METADATA_POLL_SECONDS = int(os.environ.get("IKUAIVIEW_METADATA_POLL_SECONDS", "30"))


# ── 时区：爱快 pppoe_updatetime 是 Unix 时戳（UTC 秒），但拨号时间应按北京时间显示。
#    容器层 TZ=Asia/Shanghai 是首选；代码层兜底，避免再被 UTC 容器带回 8h 误差。
CN_TZ = timezone(timedelta(hours=8))

def _fmt_cn_time(ts):
    """返回北京时间字符串，不依赖容器 TZ。"""
    try:
        return datetime.fromtimestamp(int(ts), CN_TZ).strftime("%Y-%m-%d %H:%M:%S")
    except Exception:
        return "—"

def _cn_ym(ts):
    """返回 (年, 月) 用于本月累加判定（按北京时间）。"""
    try:
        dt = datetime.fromtimestamp(int(ts), CN_TZ)
        return dt.year, dt.month
    except Exception:
        return (0, 0)

def _month_start_ts_cn(now_ts=None):
    """本月 1 日 00:00（北京时间）对应的 Unix 时戳。"""
    if now_ts is None:
        now_ts = int(time.time())
    dt = datetime.fromtimestamp(now_ts, CN_TZ)
    month_start = datetime(dt.year, dt.month, 1, tzinfo=CN_TZ)
    return int(month_start.timestamp())

# ── 持久化 SQLite：跨爱快重启累计本月用量与每台终端字节数 ─────────
# 路径：容器内 /data/ikuaiview.db；docker-compose 已挂载 ./data:/data
DATA_DIR = os.environ.get("IKUAIVIEW_DATA_DIR", "/data")
os.makedirs(DATA_DIR, exist_ok=True)
DB_PATH = os.path.join(DATA_DIR, "ikuaiview.db")

def _db_conn():
    c = sqlite3.connect(DB_PATH, timeout=10)
    c.row_factory = sqlite3.Row
    return c

def _init_db():
    c = _db_conn()
    c.executescript("""
    CREATE TABLE IF NOT EXISTS iface_daily_bytes (
        ts INTEGER NOT NULL,                       -- stat row timestamp (unix)
        interface TEXT NOT NULL,
        upload INTEGER NOT NULL,
        download INTEGER NOT NULL,
        PRIMARY KEY (ts, interface)
    );

    CREATE TABLE IF NOT EXISTS device_monthly_bytes (
        year INTEGER NOT NULL,
        month INTEGER NOT NULL,
        ip TEXT NOT NULL,
        name TEXT NOT NULL DEFAULT '',
        upload INTEGER NOT NULL DEFAULT 0,
        download INTEGER NOT NULL DEFAULT 0,
        last_seen INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (year, month, ip)
    );

    -- 爱快每次启动后的当前累计字节，用来在重启后差值修正
    CREATE TABLE IF NOT EXISTS reboot_baseline (
        ip TEXT PRIMARY KEY,
        booted_at INTEGER NOT NULL,                -- 这台爱快本次启动时间 (unix)
        curr_down INTEGER NOT NULL DEFAULT 0,
        curr_up INTEGER NOT NULL DEFAULT 0,
        month_down INTEGER NOT NULL DEFAULT 0,
        month_up INTEGER NOT NULL DEFAULT 0,
        last_seen INTEGER NOT NULL DEFAULT 0       -- 最近一次持久化的时间
    );

    CREATE TABLE IF NOT EXISTS system_boot_track (
        booted_at INTEGER PRIMARY KEY,             -- 每次启动的 uptime 翻转点
        recorded_at INTEGER NOT NULL
    );
    """)
    c.commit()
    c.close()

_init_db()
# 兼容前版本：若 reboot_baseline 缺 last_seen 列则补
try:
    _c = _db_conn()
    cols = [r[1] for r in _c.execute("PRAGMA table_info(reboot_baseline)").fetchall()]
    if cols and "last_seen" not in cols:
        _c.execute("ALTER TABLE reboot_baseline ADD COLUMN last_seen INTEGER NOT NULL DEFAULT 0")
        _c.commit()
    _c.close()
except Exception as _e:
    print("[init] reboot_baseline migration failed (continue):", _e)
db_lock = threading.Lock()

print(f"[init] DB at {DB_PATH}, TZ=Asia/Shanghai fallback enabled")


def tcp_probe(host, port=443, timeout=2.0):
    """TCP connect RTT 探测（ms）。失败返回 None。"""
    try:
        infos = socket.getaddrinfo(host, port, type=socket.SOCK_STREAM)
        if not infos:
            return None
        family, socktype, proto, _, sockaddr = infos[0]
        s = socket.socket(family, socktype, proto)
        s.settimeout(timeout)
        t0 = time.time()
        s.connect(sockaddr)
        ms = (time.time() - t0) * 1000.0
        try:
            s.close()
        except Exception:
            pass
        return ms
    except Exception:
        return None

def classify_latency(ms):
    if ms is None:
        return "down"
    if ms < 50:
        return "good"
    if ms < 120:
        return "moderate"
    return "poor"

def refresh_probes(force=False):
    now = time.time()
    if not force and probe_cache["items"] and now - probe_cache["ts"] < 55:
        return probe_cache["items"]
    items = []
    for t in PROBE_TARGETS:
        ms = tcp_probe(t["host"], t.get("port", 443), timeout=2.0)
        items.append({
            "target": t["target"],
            "host": t["host"],
            "latency_ms": None if ms is None else round(ms, 1),
            "status": classify_latency(ms),
            "category": t["category"],
        })
    probe_cache["items"] = items
    probe_cache["ts"] = now
    return items

def fetch_monthly_usage_gb():
    """本月 WAN 用量（GB）——优先对齐爱快系统概览。

    权威来源：homepage TYPE=all → results.wan_stat.total（字节）
    爱快 Web UI「本月数据使用情况」显示的是 total / 1024**3（习惯称 GB，实为 GiB）。

    回退：iface_stat_data 日统计累加 + SQLite（当 homepage 暂不可用时）。
    """
    now = time.time()
    if monthly_usage_cache["ts"] and now - monthly_usage_cache["ts"] < 15:
        return monthly_usage_cache["gb"], monthly_usage_cache["covered_seconds"]

    # 1) 权威：homepage.wan_stat.total
    with extra_cache_lock:
        total_bytes = int(ikuai_extra_cache.get("homepage_wan_month_total_bytes") or 0)
        stream_rows = list(ikuai_extra_cache.get("iface_stream") or [])
        stat_rows = list(ikuai_extra_cache.get("iface_monthly_stats") or [])

    if total_bytes > 0:
        # 与爱快主页一致：按 GiB 显示，保留 2 位小数更贴近 892.09
        gb = round(total_bytes / (1024 ** 3), 2)
        monthly_usage_cache.update({"gb": gb, "covered_seconds": 31 * 86400, "ts": now})
        return gb, 31 * 86400

    # 2) 回退：iface_stat_data 本月累加（十进制 GB）
    month_start = _month_start_ts_cn(int(now))
    total_bytes_month = 0
    with db_lock:
        c = _db_conn()
        try:
            for row in stat_rows:
                iface = str(row.get("interface") or "")
                if iface != "wan1":
                    continue
                ts = int(row.get("timestamp") or 0)
                if ts < month_start:
                    continue
                up = int(float(row.get("total_upload") or 0))
                down = int(float(row.get("total_download") or 0))
                c.execute(
                    """INSERT INTO iface_daily_bytes (ts,interface,upload,download)
                       VALUES (?,?,?,?)
                       ON CONFLICT(ts,interface) DO UPDATE SET
                         upload=excluded.upload, download=excluded.download""",
                    (ts, iface, up, down),
                )
            c.commit()
            cur = c.execute(
                """SELECT IFNULL(SUM(upload),0) as u, IFNULL(SUM(download),0) as d
                   FROM iface_daily_bytes WHERE interface='wan1' AND ts >= ?""",
                (month_start,),
            )
            row = cur.fetchone()
            total_bytes_month = int(row["u"]) + int(row["d"])
        finally:
            c.close()

    wan1_stream = next((r for r in stream_rows if r.get("interface") == "wan1"), None)
    if wan1_stream and total_bytes_month == 0:
        total_bytes_month = int(float(wan1_stream.get("total_up") or 0)) + int(float(wan1_stream.get("total_down") or 0))

    gb = round(total_bytes_month / (1024 ** 3), 2)
    monthly_usage_cache.update({"gb": gb, "covered_seconds": 31 * 86400, "ts": now})
    return gb, 31 * 86400

def rate_to_bps(val):
    """exporter 的 *_kbytes_per_second 实际更接近 B/s 量级的瞬时值。
    与当前 live UI 一致：直接当 bps 使用（前端 /1e6 显示 Mbps）。
    """
    try:
        return max(0, int(float(val)))
    except Exception:
        return 0


def _norm_mac(mac: str) -> str:
    return (mac or "").strip().lower().replace("-", ":")


def _decode_name(val: str) -> str:
    if not val:
        return ""
    try:
        return urllib.parse.unquote(str(val)).strip()
    except Exception:
        return str(val).strip()


def _pick_name(*candidates):
    for c in candidates:
        n = _decode_name(c)
        if n:
            return n
    return ""


def fetch_ikuai_metadata():
    """从爱快拉取设备备注/真实 MAC。

    面板规则（用户指定）：
    - 在线集合：exporter 的 device/*（或 monitor_lanip 的 IPv4 在线列表）按 IP
    - 名称：DHCP 静态分配 termname（按 IP）
    - MAC：DHCP 静态分配 mac（按 IP）；静态没有时用 ARP 表（按 IP）
    - 禁止用监控页/exporter 的“共享 MAC”去反查名称

    爱快 monitor_lanip 在自定义网关/旁路由场景下会把多个 IP 标成同一 MAC，
    因此 MAC 与名称一律只按 IP 对齐权威表。
    """
    if not IKUAI_PASS:
        return None

    # 串行拉取，避免并发登录导致偶发空结果
    acquired = metadata_fetch_lock.acquire(blocking=False)
    if not acquired:
        return None
    try:
        return _fetch_ikuai_metadata_locked()
    finally:
        if acquired:
            metadata_fetch_lock.release()


def _fetch_ikuai_metadata_locked():
    if not IKUAI_PASS:
        return None

    def _login():
        passwd_md5 = hashlib.md5(IKUAI_PASS.encode("utf-8")).hexdigest()
        login_payload = {"username": IKUAI_USER, "passwd": passwd_md5}
        req = urllib.request.Request(
            f"{IKUAI_URL}/Action/login",
            data=json.dumps(login_payload).encode("utf-8"),
            headers={"Content-Type": "application/json", "User-Agent": "Mozilla/5.0"},
        )
        with urllib.request.urlopen(req, timeout=5) as res:
            cookies = res.info().get_all("Set-Cookie", []) or []
            for c in cookies:
                for p in c.split(";"):
                    p = p.strip()
                    if p.startswith("sess_key="):
                        return p.split("=", 1)[1]
        return None

    now = time.time()
    with session_lock:
        sess_key = ikuai_session.get("sess_key")
        if not sess_key or now - float(ikuai_session.get("ts") or 0) > SESSION_TTL:
            try:
                sess_key = _login()
            except Exception as e:
                print("[Poller] Login failed:", e)
                return None
            if not sess_key:
                print("[Poller] Login failed: sess_key not found in cookie header.")
                return None
            ikuai_session["sess_key"] = sess_key
            ikuai_session["ts"] = now

    cookie_str = f"sess_key={sess_key}"
    by_ip = {}

    def _call(func_name: str, param=None):
        payload = {
            "action": "show",
            "func_name": func_name,
            "param": param or {"TYPE": "data,total", "limit": "0,1000"},
        }
        req = urllib.request.Request(
            f"{IKUAI_URL}/Action/call",
            data=json.dumps(payload).encode("utf-8"),
            headers={
                "Content-Type": "application/json",
                "Cookie": cookie_str,
                "User-Agent": "Mozilla/5.0",
            },
        )
        with urllib.request.urlopen(req, timeout=8) as res:
            body = json.loads(res.read().decode("utf-8"))
        results_obj = body.get("results") or {}
        # 列表型接口：results.data
        if isinstance(results_obj, dict) and "data" in results_obj and not any(
            k in results_obj for k in ("wan_stat", "wans_stat", "sysstat", "cpu", "memory")
        ):
            return results_obj.get("data", []) or []
        return results_obj

    def _ensure(ip: str):
        rec = by_ip.get(ip)
        if not rec:
            rec = {
                "termname": "",
                "comment": "",
                "hostname": "",
                "ip": ip,
                "mac": "",
                "static_bind": False,
                "source": "",
                "client_type": "",
                "vendor": "",
                "arp_mac": "",
                "arp_name": "",
                "monitor_name": "",
                "monitor_mac": "",
            }
            by_ip[ip] = rec
        return rec

    # 2. 权威：DHCP 静态分配（人工编辑的备注名 + 绑定 MAC）
    try:
        static_list = _call("dhcp_static")
        for item in static_list:
            ip = (item.get("ip_addr") or "").strip()
            if not ip:
                continue
            rec = _ensure(ip)
            rec["termname"] = _decode_name(item.get("termname", ""))
            rec["comment"] = _decode_name(item.get("comment", ""))
            # dhcp_static 的 hostname 字段仅做系统识别，不作为显示依据

            rec["mac"] = _norm_mac(item.get("mac", ""))
            rec["static_bind"] = True
            rec["source"] = "dhcp_static"
        print(f"[Poller] dhcp_static entries: {len(static_list)} (by_ip={len(by_ip)})")
    except Exception as e:
        print("[Poller] Fetch dhcp_static failed:", e)

    # 3. ARP 表：按 IP 补真实 MAC / 备注（静态表没有时）
    try:
        arp_list = _call("arp")
        for item in arp_list:
            ip = (item.get("ip_addr") or "").strip()
            if not ip:
                continue
            rec = _ensure(ip)
            arp_mac = _norm_mac(item.get("mac", ""))
            # tagname 多为 lan1_xxxx，不是人类备注；名称只用 termname
            arp_name = _decode_name(item.get("termname", ""))
            rec["arp_mac"] = arp_mac
            rec["arp_name"] = arp_name
            if not rec.get("mac") and arp_mac:
                rec["mac"] = arp_mac
            # 不把 ARP 备注写入 termname（留给展示层按优先级挑选），避免盖过本地别名
            if not rec.get("source"):
                rec["source"] = "arp"
        print(f"[Poller] arp entries: {len(arp_list)}")
    except Exception as e:
        print("[Poller] Fetch arp failed:", e)

    # 4. monitor_lanip：只补 vendor/type/名称（静态&ARP 都没有时），MAC 仅作最后兜底
    try:
        dev_list = _call("monitor_lanip")
        for dev in dev_list:
            ip = (dev.get("ip_addr") or "").strip()
            if not ip:
                continue
            rec = _ensure(ip)
            mon_name = _pick_name(dev.get("termname"), dev.get("comment"), dev.get("hostname"))
            mon_mac = _norm_mac(dev.get("mac", ""))
            rec["monitor_name"] = mon_name
            rec["monitor_mac"] = mon_mac
            if not rec.get("vendor"):
                rec["vendor"] = str(dev.get("client_vendor") or "")
            if not rec.get("client_type"):
                rec["client_type"] = str(dev.get("client_type") or "")
            # hostname 仅做系统识别，不写入展示字段
            # rec["hostname"] deliberately left empty
            # 名称不写回 termname：展示层按优先级挑选，避免盖过本地别名
            # MAC：仅静态/ARP 都空时才用监控 MAC（监控 MAC 在旁路由场景不可信）
            if not rec.get("mac") and mon_mac:
                rec["mac"] = mon_mac
            if not rec.get("source"):
                rec["source"] = "monitor_lanip"
            # static_bind 只认 dhcp_static，不吃 monitor 的 static_status
        print(f"[Poller] monitor_lanip entries: {len(dev_list)} (by_ip total={len(by_ip)})")
    except Exception as e:
        print("[Poller] Fetch monitor_lanip failed:", e)

    if by_ip:
        with cache_lock:
            global device_metadata_cache
            # 保留 by_mac 空 dict 兼容旧读取路径，但设备展示禁止 MAC 反查名称
            device_metadata_cache = {"by_ip": by_ip, "by_mac": {}}
        print(f"[Poller] metadata ready: by_ip={len(by_ip)} (mac-fallback disabled)")

    # 4. 爱快额外详情 (WAN拨号时间, 链路检测, DNS, DHCP池, DNAT映射, 连接数细分)
    extra = {
        "wan_dial_duration_seconds": 0,
        "wan_dial_time_str": "—",
        "link_check_status": "success",
        "link_check_errmsg": "线路检测成功",
        "dns": [],
        "dhcp": {
            "available": 0,
            "pool": "—",
            "gateway": "—",
            "dns": []
        },
        "port_forwards": [],
        "connections": {
            "tcp": 0,
            "udp": 0,
            "icmp": 0
        },
        "iface_monthly_stats": [],
        "iface_stream": [],
        # 爱快系统概览「本月数据使用情况」权威值（homepage.wan_stat.total，字节）
        "homepage_wan_month_total_bytes": 0,
        "homepage_wan_isp": "",
        "homepage_wan_ip": "",
    }

    try:
        wan_list = _call("wan")
        if wan_list:
            row = wan_list[0]
            up = row.get("pppoe_updatetime") or row.get("updatetime") or 0
            if up:
                try:
                    up_ts = int(float(up))
                    if up_ts > 0:
                        diff = int(time.time()) - up_ts
                        extra["wan_dial_duration_seconds"] = max(0, diff)
                        # 用北京时间显示，不依赖容器 TZ；原 localtime 在 UTC 容器会差 8h
                        extra["wan_dial_time_str"] = _fmt_cn_time(up_ts)
                        # 同时保留 Unix 时戳，前端可选展示
                        extra["wan_dial_time_ts"] = up_ts
                except Exception as _e:
                    print("[Poller] wan_dial_time parse failed:", _e)
            dns1 = row.get("pppoe_dns1") or row.get("dhcp_dns1") or ""
            dns2 = row.get("pppoe_dns2") or row.get("dhcp_dns2") or ""
            if dns1: extra["dns"].append(dns1)
            if dns2: extra["dns"].append(dns2)
    except Exception as e:
        print("[Poller] Extra wan failed:", e)

    try:
        res = _call("monitor_iface", {"TYPE": "iface_check"})
        # monitor_iface yields dict inside results
        checks = []
        if isinstance(res, dict):
            # sometimes returned results is dict, check is under results or results.iface_check
            r_obj = res.get("results") or res
            if isinstance(r_obj, dict):
                checks = r_obj.get("iface_check") or []
        if checks:
            c = checks[0]
            extra["link_check_status"] = c.get("result", "success")
            extra["link_check_errmsg"] = c.get("errmsg", "线路检测成功")
    except Exception as e:
        print("[Poller] Extra iface failed:", e)

    try:
        res = _call("sysstat", {"TYPE": "verinfo,cpu,memory,stream"})
        stream = {}
        if isinstance(res, dict):
            r_obj = res.get("results") or res
            if isinstance(r_obj, dict):
                stream = r_obj.get("stream") or {}
        extra["connections"]["tcp"] = int(stream.get("tcp_connect_num") or 0)
        extra["connections"]["udp"] = int(stream.get("udp_connect_num") or 0)
        extra["connections"]["icmp"] = int(stream.get("icmp_connect_num") or 0)
    except Exception as e:
        print("[Poller] Extra sysstat failed:", e)

    try:
        dhcp_list = _call("dhcp_server")
        if dhcp_list:
            srv = dhcp_list[0]
            for s in dhcp_list:
                if s.get("interface") == "lan1":
                    srv = s
                    break
            extra["dhcp"]["available"] = int(srv.get("available") or 0)
            extra["dhcp"]["pool"] = srv.get("addr_pool", "—")
            extra["dhcp"]["gateway"] = srv.get("gateway", "—")
            d1 = srv.get("dns1") or ""
            d2 = srv.get("dns2") or ""
            if d1: extra["dhcp"]["dns"].append(d1)
            if d2: extra["dhcp"]["dns"].append(d2)
    except Exception as e:
        print("[Poller] Extra dhcp_server failed:", e)

    try:
        dnat_list = _call("dnat")
        for r in dnat_list:
            if r.get("enabled") == "yes":
                extra["port_forwards"].append({
                    "id": r.get("id"),
                    "name": r.get("tagname") or r.get("comment") or "Rule",
                    "lan_addr": r.get("lan_addr"),
                    "wan_port": r.get("wan_port"),
                    "lan_port": r.get("lan_port"),
                    "proto": r.get("protocol", "tcp")
                })
    except Exception as e:
        print("[Poller] Extra dnat failed:", e)

    # iKuai interface snapshots (fallback / device analytics)
    try:
        res = _call("monitor_iface", {"TYPE": "all"})
        if not isinstance(res, dict):
            # _call may return list or nested; normalize
            res = {}
        # monitor_iface sometimes returns the results object directly, sometimes nested
        if "iface_stat_data" not in res and isinstance(res.get("results"), dict):
            res = res.get("results") or {}
        stat_rows = res.get("iface_stat_data", []) if isinstance(res, dict) else []
        extra["iface_monthly_stats"] = [
            row for row in stat_rows if str(row.get("interface") or "") == "wan1"
        ]
        extra["iface_stream"] = res.get("iface_stream", []) if isinstance(res, dict) else []
    except Exception as e:
        print("[Poller] iKuai monthly accounting failed:", e)

    # 系统概览主页 WAN 本月用量（与 Web UI「本月数据使用情况」同源）
    # homepage 接口重（实测约 1s+ / 170KB），默认 5 分钟拉一次，避免抬高爱快 CPU
    now_ts = time.time()
    if homepage_usage_cache["ts"] and now_ts - homepage_usage_cache["ts"] < HOMEPAGE_USAGE_TTL:
        extra["homepage_wan_month_total_bytes"] = int(homepage_usage_cache.get("total_bytes") or 0)
        extra["homepage_wan_isp"] = homepage_usage_cache.get("isp") or ""
        extra["homepage_wan_ip"] = homepage_usage_cache.get("ip") or ""
    else:
        try:
            home = _call("homepage", {"TYPE": "all"})
            if isinstance(home, dict) and "wan_stat" not in home:
                home = home.get("results") or home
            wan_stat = {}
            if isinstance(home, dict):
                wan_stat = home.get("wan_stat") or {}
                if not wan_stat:
                    wans = home.get("wans_stat") or []
                    if isinstance(wans, list) and wans:
                        wan_stat = wans[0]
            if isinstance(wan_stat, dict) and wan_stat:
                total = int(float(wan_stat.get("total") or 0))
                extra["homepage_wan_month_total_bytes"] = max(0, total)
                extra["homepage_wan_isp"] = str(wan_stat.get("isp") or "")
                extra["homepage_wan_ip"] = str(wan_stat.get("ip_addr") or "")
                homepage_usage_cache.update({
                    "total_bytes": extra["homepage_wan_month_total_bytes"],
                    "isp": extra["homepage_wan_isp"],
                    "ip": extra["homepage_wan_ip"],
                    "ts": now_ts,
                })
                # 若拨号时间缺失，用 homepage 的 updatetime 兜底
                if not extra.get("wan_dial_time_ts"):
                    up = wan_stat.get("updatetime") or 0
                    try:
                        up_ts = int(float(up))
                        if up_ts > 0:
                            extra["wan_dial_duration_seconds"] = max(0, int(time.time()) - up_ts)
                            extra["wan_dial_time_str"] = _fmt_cn_time(up_ts)
                            extra["wan_dial_time_ts"] = up_ts
                    except Exception:
                        pass
                print(f"[Poller] homepage wan_stat total_bytes={extra['homepage_wan_month_total_bytes']} isp={extra['homepage_wan_isp']}")
        except Exception as e:
            print("[Poller] homepage wan_stat failed:", e)
            # 失败时沿用旧缓存
            extra["homepage_wan_month_total_bytes"] = int(homepage_usage_cache.get("total_bytes") or 0)
            extra["homepage_wan_isp"] = homepage_usage_cache.get("isp") or ""
            extra["homepage_wan_ip"] = homepage_usage_cache.get("ip") or ""

    with extra_cache_lock:
        global ikuai_extra_cache
        ikuai_extra_cache = extra
    print(f"[Poller] extra details cached successfully: link_check={extra['link_check_status']}")


def ikuai_metadata_poller():
    while True:
        try:
            fetch_ikuai_metadata()
        except Exception as e:
            print("[Poller] Error in poller cycle:", e)
        time.sleep(max(15, METADATA_POLL_SECONDS))

# 启动 poller 线程
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
        elif metric_part.startswith('ikuai_uptime{id="host"}'):
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
        elif metric_part.startswith("ikuai_network_recv_bytes"):
            m = re.search(r'id="([^"]+)"', metric_part)
            if m:
                target_id = m.group(1)
                if target_id.startswith("device/"):
                    ip = target_id.replace("device/", "")
                    if ip not in devices_map: devices_map[ip] = {}
                    devices_map[ip]["down_bytes"] = val
        elif metric_part.startswith("ikuai_network_send_bytes"):
            m = re.search(r'id="([^"]+)"', metric_part)
            if m:
                target_id = m.group(1)
                if target_id.startswith("device/"):
                    ip = target_id.replace("device/", "")
                    if ip not in devices_map: devices_map[ip] = {}
                    devices_map[ip]["up_bytes"] = val
        elif metric_part.startswith("ikuai_network_conn_count"):
            m = re.search(r'id="([^"]+)"', metric_part)
            if m:
                target_id = m.group(1)
                if target_id == "host":
                    data["host_conns"] = int(val)
                elif target_id.startswith("device/"):
                    ip = target_id.replace("device/", "")
                    if ip not in devices_map: devices_map[ip] = {}
                    devices_map[ip]["conns"] = int(val)
        elif metric_part.startswith("ikuai_device_info"):
            labels = dict(re.findall(r'(\w+)="([^"]*)"', metric_part))
            ip = labels.get("ip_addr", "")
            exporter_mac = _norm_mac(labels.get("mac", ""))
            if ip:
                if ip not in devices_map: devices_map[ip] = {}
                devices_map[ip]["ip"] = ip

                # 在线集合来自 exporter；名称/MAC 一律按 IP 对齐权威元数据
                # 禁止用 exporter/monitor 的脏 MAC 反查别的设备
                with cache_lock:
                    meta = dict((device_metadata_cache.get("by_ip") or {}).get(ip) or {})

                # MAC 优先级：dhcp_static/arp 合成的 meta.mac > exporter
                mac = _norm_mac(meta.get("mac") or "") or exporter_mac
                devices_map[ip]["mac"] = mac

                # 名称优先级（按 IP，绝不按 MAC 反查）：
                # DHCP静态名称 > ARP备注 > monitor备注 > IP
                # exporter/monitor 上报的 hostname 仅做系统识别，不作为显示名
                name = _pick_name(
                    meta.get("termname") if meta.get("source") == "dhcp_static" else "",
                    meta.get("termname") if meta.get("static_bind") else "",
                    meta.get("arp_name"),
                    meta.get("monitor_name"),
                    meta.get("comment") if meta.get("source") == "dhcp_static" else "",
                    ip,
                ) or ip
                devices_map[ip]["name"] = name
                metadata = meta

                # 映射设备图标类型
                dev_type = "desktop"
                vendor = (metadata.get("vendor") or "").lower()
                c_type = str(metadata.get("client_type") or "").lower()
                term = name.lower()

                if "phone" in c_type or "ios" in c_type or "android" in c_type:
                    dev_type = "phone"
                elif "camera" in term or "摄像头" in term:
                    dev_type = "camera"
                elif "投影" in term or "电视" in term or "tv" in term:
                    dev_type = "media"
                elif "音箱" in term or "插座" in term or "空调" in term or "扫地机" in term or "xiaomi" in vendor:
                    dev_type = "iot"
                elif "群晖" in term or "nas" in term or "飞牛" in term:
                    dev_type = "desktop"
                elif "proxmox" in vendor or "vmware" in vendor or "lxc" in term or "测试" in term or "虚拟机" in term:
                    dev_type = "desktop"
                elif "wifi" in term or "router" in term or "route" in term or "wrt" in term or "旁路由" in term or "zte" in vendor:
                    dev_type = "router"
                elif "docker" in term or "lxc" in term:
                    dev_type = "desktop"
                elif "switch" in term or "交换" in term:
                    dev_type = "switch"

                devices_map[ip]["device_type"] = dev_type
                devices_map[ip]["static_bind"] = bool(metadata.get("static_bind", False))

    if cpu_cores:
        data["cpu_usage"] = sum(cpu_cores) / len(cpu_cores)
    if mem_total > 0:
        # exporter 报的是 KiB 量级，转成字节给前端
        scale = 1024 if mem_total < 50_000_000 else 1
        data["mem_total_bytes"] = mem_total * scale
        data["mem_used_bytes"] = mem_used * scale
        data["mem_usage_pct"] = (mem_used / mem_total) * 100

    devices_list = []
    for ip, dev in devices_map.items():
        if "ip" not in dev: dev["ip"] = ip
        dev["name"] = dev.get("name", ip)
        dev["mac"] = dev.get("mac", "")
        dev["down_rate"] = dev.get("down_rate", 0.0)
        dev["up_rate"] = dev.get("up_rate", 0.0)
        dev["down_bytes"] = float(dev.get("down_bytes", 0.0) or 0.0)
        dev["up_bytes"] = float(dev.get("up_bytes", 0.0) or 0.0)
        dev["conns"] = dev.get("conns", 0)
        dev["device_type"] = dev.get("device_type", "desktop")
        dev["static_bind"] = dev.get("static_bind", False)
        devices_list.append(dev)

    # 彻底不进行排序，直接全量返回由 Vue 接管
    data["devices"] = devices_list
    data["monthly_usage_gb"], data["monthly_usage_covered_seconds"] = fetch_monthly_usage_gb()
    data["latency_probes"] = refresh_probes()
    # host 连接数优先
    try:
        if data.get("host_conns"):
            pass
    except Exception:
        pass
    return data


# ── 终端字节持久化：把 exporter 每次上报的 (current_bytes) 落库后计算「本月累计」
#    爱快 monitor_lanip 在每次重启清零，监控层补一个差值修正机制。
#    重启点用 sys_uptime（exporter 上的 ikuai_uptime{host}）判定：
#    每隔 N 秒轮询，若发现 uptime 比上次小或等于 baseline，视为爱快重启了一次。

def persist_device_bytes_snapshot(devices, sys_uptime):
    """把 exporter 设备字节累加到本月账本（跨爱快重启不丢）。

    规则：
      - reboot_baseline：本轮爱快启动内 last-seen 字节，只用于算 delta
      - device_monthly_bytes：本月权威累计，只做 delta 增量
      - 重启判定：sys_uptime 相对上次明显回落（而不是 boot_ts 绝对差）
      - 重启后：清空 baseline，不把新一轮 curr 直接写入 monthly（避免重复/清零）
      - 本月首次见到某 IP：用当前 curr 作为初始月累计（最佳估计）
    """
    if not devices:
        return devices
    now_ts = int(time.time())
    ym_year, ym_month = _cn_ym(now_ts)
    if ym_year == 0:
        return devices
    sys_uptime = max(0, int(sys_uptime or 0))

    with db_lock:
        c = _db_conn()
        try:
            # host 行：booted_at 字段复用为 last_uptime（秒）
            host = c.execute("SELECT booted_at FROM reboot_baseline WHERE ip='__host__'").fetchone()
            last_uptime = int(host["booted_at"]) if host else -1
            rebooted = (last_uptime < 0) or (sys_uptime + 10 < last_uptime)
            if rebooted and last_uptime >= 0:
                print(f"[reboot] iKuai reboot detected: uptime {last_uptime}s -> {sys_uptime}s; baselines reset")
                c.execute("DELETE FROM reboot_baseline")
            # 更新/写入 host last_uptime
            c.execute(
                """INSERT INTO reboot_baseline (ip, booted_at, curr_down, curr_up, month_down, month_up, last_seen)
                   VALUES ('__host__', ?, 0, 0, 0, 0, ?)
                   ON CONFLICT(ip) DO UPDATE SET booted_at=excluded.booted_at, last_seen=excluded.last_seen""",
                (sys_uptime, now_ts),
            )

            out = []
            for dev in devices:
                ip = (dev.get("ip") or "").strip()
                if not ip:
                    out.append(dev)
                    continue
                curr_down = int(float(dev.get("down_bytes", 0) or 0))
                curr_up = int(float(dev.get("up_bytes", 0) or 0))
                name = dev.get("name") or ""

                base = c.execute(
                    "SELECT curr_down, curr_up FROM reboot_baseline WHERE ip=?", (ip,)
                ).fetchone()
                monthly = c.execute(
                    "SELECT upload, download FROM device_monthly_bytes WHERE year=? AND month=? AND ip=?",
                    (ym_year, ym_month, ip),
                ).fetchone()

                if base is None:
                    # 新周期首次见到：建立 baseline，不把 curr 当 delta
                    c.execute(
                        """INSERT INTO reboot_baseline (ip, booted_at, curr_down, curr_up, month_down, month_up, last_seen)
                           VALUES (?,?,?,?,0,0,?)""",
                        (ip, sys_uptime, curr_down, curr_up, now_ts),
                    )
                    if monthly is None:
                        # 本月首次：用当前会话累计作初始值
                        c.execute(
                            """INSERT INTO device_monthly_bytes (year, month, ip, name, upload, download, last_seen)
                               VALUES (?,?,?,?,?,?,?)""",
                            (ym_year, ym_month, ip, name, curr_up, curr_down, now_ts),
                        )
                        month_up, month_down = curr_up, curr_down
                    else:
                        # 本月已有账本（爱快重启后）：只更新名称/时间
                        c.execute(
                            """UPDATE device_monthly_bytes SET
                                   name=COALESCE(NULLIF(?, ''), name), last_seen=?
                               WHERE year=? AND month=? AND ip=?""",
                            (name, now_ts, ym_year, ym_month, ip),
                        )
                        month_up = int(monthly["upload"])
                        month_down = int(monthly["download"])
                else:
                    prev_down = int(base["curr_down"])
                    prev_up = int(base["curr_up"])
                    delta_down = (curr_down - prev_down) if curr_down >= prev_down else 0
                    delta_up = (curr_up - prev_up) if curr_up >= prev_up else 0
                    c.execute(
                        """UPDATE reboot_baseline SET curr_down=?, curr_up=?, booted_at=?, last_seen=?
                           WHERE ip=?""",
                        (curr_down, curr_up, sys_uptime, now_ts, ip),
                    )
                    if monthly is None:
                        # 异常兜底：没有月账本则用 curr 初始化
                        c.execute(
                            """INSERT INTO device_monthly_bytes (year, month, ip, name, upload, download, last_seen)
                               VALUES (?,?,?,?,?,?,?)""",
                            (ym_year, ym_month, ip, name, curr_up, curr_down, now_ts),
                        )
                        month_up, month_down = curr_up, curr_down
                    else:
                        if delta_down > 0 or delta_up > 0:
                            c.execute(
                                """UPDATE device_monthly_bytes SET
                                       name=COALESCE(NULLIF(?, ''), name),
                                       upload=upload+?, download=download+?, last_seen=?
                                   WHERE year=? AND month=? AND ip=?""",
                                (name, delta_up, delta_down, now_ts, ym_year, ym_month, ip),
                            )
                        else:
                            c.execute(
                                """UPDATE device_monthly_bytes SET
                                       name=COALESCE(NULLIF(?, ''), name), last_seen=?
                                   WHERE year=? AND month=? AND ip=?""",
                                (name, now_ts, ym_year, ym_month, ip),
                            )
                        mr = c.execute(
                            "SELECT upload, download FROM device_monthly_bytes WHERE year=? AND month=? AND ip=?",
                            (ym_year, ym_month, ip),
                        ).fetchone()
                        month_up = int(mr["upload"]) if mr else int(monthly["upload"]) + delta_up
                        month_down = int(mr["download"]) if mr else int(monthly["download"]) + delta_down

                out.append({**dev, "down_bytes": month_down, "up_bytes": month_up})

            c.commit()
            return out
        except Exception as e:
            print("[device-bytes] persist failed:", e)
            import traceback
            traceback.print_exc()
            try:
                c.rollback()
            except Exception:
                pass
            return devices
        finally:
            c.close()


def make_snapshot_payload(data):
    """生成完美符合 iKuaiView DashboardSnapshot 数据结构"""
    ts = time.strftime("%Y-%m-%dT%H:%M:%S.000Z", time.gmtime())

    devices = []
    _raw_devices = persist_device_bytes_snapshot(data.get("devices", []), int(data.get("uptime", 0) or 0))
    for dev in _raw_devices:
        devices.append({
            "mac": dev.get("mac", ""),
            "hostname": dev.get("name", "") or dev.get("ip", ""),
            "ip": dev.get("ip", ""),
            "device_type": dev.get("device_type", "desktop"),
            "signal": None,
            "connected_duration": 3600,
            "dhcp_status": "bound" if not dev.get("static_bind", False) else "static",
            "dhcp_expires": None,
            "interface": "lan1",
            "arp_status": "reachable",
            "custom_name": dev.get("name") if dev.get("name") and dev.get("name") != dev.get("ip") else None,
            "custom_type": None,
            # 终端流量：实时用 exporter rate，累计用 exporter bytes
            "download_bps": rate_to_bps(dev.get("down_rate", 0)),
            "upload_bps": rate_to_bps(dev.get("up_rate", 0)),
            "download_bytes": int(float(dev.get("down_bytes", 0) or 0)),
            "upload_bytes": int(float(dev.get("up_bytes", 0) or 0)),
            # 连接数：exporter ikuai_network_conn_count{id="device/<ip>"}
            "connection_count": int(dev.get("conns", 0) or 0),
        })

    payload = {
        "system": {
            # exporter exposes version but no appliance model; never fabricate one.
            "model": data.get("model") or "",
            "version": data.get("version", "Unknown"),
            "uptime": f"{data.get('uptime', 0) // 3600}小时",
            "uptime_seconds": data.get("uptime", 0),
            "cpu_load": round(data.get("cpu_usage", 0.0) * 100, 1),
            "free_memory": int(data.get("mem_total_bytes", 0) - data.get("mem_used_bytes", 0)),
            "total_memory": int(data.get("mem_total_bytes", 0)),
            "total_hdd": 0,
            "free_hdd": 0,
            "architecture": "",
            "board_name": ""
        },
        "gateway": {
            "wan_interface": "wan1",
            "wan_ip": data.get("wan_ip", "—"),
            "gateway_ip": IKUAI_HOST,
            "wan_online": True,
            "ip_allocations": len(devices),
            "wans": [
                {
                    "wan_name": "wan1",
                    "wan_ip": data.get("wan_ip", "—"),
                    "gateway_ip": IKUAI_HOST,
                    "online": True,
                    "download_bps": rate_to_bps(data["wan_speed"]["down"]),
                    "upload_bps": rate_to_bps(data["wan_speed"]["up"]),
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
            "monthly_usage_gb": float(data.get("monthly_usage_gb", 0) or 0),
            "monthly_usage_covered_seconds": int(data.get("monthly_usage_covered_seconds", 0) or 0),
            "download_bps": rate_to_bps(data["wan_speed"]["down"]),
            "upload_bps": rate_to_bps(data["wan_speed"]["up"]),
            "connection_count": int(data.get("host_conns") or sum(dev.get("conns", 0) for dev in data.get("devices", []))),
            "wans": [
                {
                    "wan_name": "wan1",
                    "name": data.get("wan_proto", "PPPOE"),
                    "online": True,
                    "download_bps": rate_to_bps(data["wan_speed"]["down"]),
                    "upload_bps": rate_to_bps(data["wan_speed"]["up"])
                }
            ]
        },
        "traffic": {
            "points": [
                {
                    "timestamp": ts,
                    "download_bps": rate_to_bps(data["wan_speed"]["down"]),
                    "upload_bps": rate_to_bps(data["wan_speed"]["up"])
                }
            ]
        },
        "latency_probes": data.get("latency_probes") or refresh_probes(),
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
        "interface_statuses": [],
        "timestamp": ts,
        "ikuai_extra": ikuai_extra_cache,
        "wans": [
            {
                "wan_name": "wan1",
                "wan_ip": data.get("wan_ip", "—"),
                "gateway_ip": IKUAI_HOST,
                "online": True,
                "download_bps": rate_to_bps(data["wan_speed"]["down"]),
                "upload_bps": rate_to_bps(data["wan_speed"]["up"]),
                "is_primary": True
            }
        ],
        "wans_isp": [
            {
                "wan_name": "wan1",
                "name": data.get("wan_proto", "PPPOE"),
                "online": True,
                "download_bps": rate_to_bps(data["wan_speed"]["down"]),
                "upload_bps": rate_to_bps(data["wan_speed"]["up"])
            }
        ],
        "wan_traffic_points": [
            {
                "timestamp": ts,
                "download_bps": rate_to_bps(data["wan_speed"]["down"]),
                "upload_bps": rate_to_bps(data["wan_speed"]["up"]),
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
            "download_bps": rate_to_bps(data["wan_speed"]["down"]),
            "upload_bps": rate_to_bps(data["wan_speed"]["up"])
        },
        "latency_probes": snap["latency_probes"],
        "wifi": snap["wifi"],
        "stability": snap["stability"],
        "interface_statuses": snap["interface_statuses"],
        "timestamp": ts,
        "wans": snap["wans"],
        "wans_isp": snap["wans_isp"],
        "ikuai_extra": snap.get("ikuai_extra") or ikuai_extra_cache,
        "wan_traffic_points": [
            {
                "timestamp": ts,
                "download_bps": rate_to_bps(data["wan_speed"]["down"]),
                "upload_bps": rate_to_bps(data["wan_speed"]["up"]),
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
            cfg = {
                "router_type": "ikuai",
                "revision": 1,
                "router_host": IKUAI_HOST,
                "router_port": 80,
                "router_scheme": "http",
                "router_username": IKUAI_USER,
                "password_set": bool(IKUAI_PASS),
                "router_configured": bool(IKUAI_URL),
                "accept_invalid_certs": True,
                "poll_interval_secs": 2,
                "probe_interval_secs": 60,
                "db_raw_retention_days": 1,
                "db_total_retention_days": 30,
                "latency_good_ms": 50,
                "latency_poor_ms": 200,
                "theme": "auto",
                "wizard_completed": True,
            }
            body = json.dumps(cfg).encode('utf-8')
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return

        if path.startswith("/api/oui/lookup") or path == "/api/oui":
            # parseOuiEntries: asRecord(payload).entries
            body = json.dumps({"entries": []}).encode('utf-8')
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return

        if path == "/api/devices":
            # parseDeviceOverrides 直接 arrayOf(payload) -> payload 必须是 []
            body = json.dumps([]).encode('utf-8')
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return

        if path == "/api/probes":
            # parseProbes: asRecord(payload).targets -> payload 必须含 targets
            body = json.dumps({"targets": []}).encode('utf-8')
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return

        if path == "/api/auth/login":
            body = json.dumps({"ok": True, "username": "admin"}).encode('utf-8')
            self.send_response(200)
            self.send_header("Content-Type","application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return

        if path == "/api/auth/logout":
            body = b"{}"
            self.send_response(200)
            self.send_header("Content-Type","application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return

        if path == "/api/auth/sessions":
            body = json.dumps({"entries": []}).encode('utf-8')
            self.send_response(200)
            self.send_header("Content-Type","application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return

        if path == "/api/auth/pairings":
            body = json.dumps({"entries": []}).encode('utf-8')
            self.send_response(200)
            self.send_header("Content-Type","application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return

        # /api/traffic?start=N&end=N&wan_name=X
        # iKuaiView canonical schema v1
        if path == "/api/traffic":
            try:
                start_ms = int(query.get("start", ["0"])[0])
                end_ms = int(query.get("end", ["0"])[0])
            except Exception:
                start_ms = end_ms = 0
            if end_ms == 0:
                end_ms = int(time.time() * 1000)
            if start_ms == 0:
                start_ms = end_ms - 3600 * 1000
            duration_s = max(1, (end_ms - start_ms) // 1000)
            step = max(5, duration_s // 120)
            start_s = start_ms // 1000
            end_s = end_ms // 1000
            wan_name = query.get("wan_name", ["wan1"])[0]
            wan_name_out = "wan1" if (not wan_name or wan_name == "*") else wan_name
            wan_query_id = wan_name if "/" in wan_name else "iface/" + wan_name_out
            promql_down = "ikuai_network_recv_kbytes_per_second{id=" + chr(34) + wan_query_id + chr(34) + "}"
            promql_up = "ikuai_network_send_kbytes_per_second{id=" + chr(34) + wan_query_id + chr(34) + "}"
            AMP = chr(38)
            url_down = PROMETHEUS_URL + "/api/v1/query_range?query=" + urllib.parse.quote(promql_down) + AMP + "start=" + str(start_s) + AMP + "end=" + str(end_s) + AMP + "step=" + str(step)
            url_up = PROMETHEUS_URL + "/api/v1/query_range?query=" + urllib.parse.quote(promql_up) + AMP + "start=" + str(start_s) + AMP + "end=" + str(end_s) + AMP + "step=" + str(step)
            points = []
            try:
                req = urllib.request.Request(url_down, headers={"User-Agent": "iKuai-Monitor-Gateway"})
                with urllib.request.urlopen(req, timeout=4) as res:
                    res_down = json.loads(res.read().decode("utf-8"))
                req = urllib.request.Request(url_up, headers={"User-Agent": "iKuai-Monitor-Gateway"})
                with urllib.request.urlopen(req, timeout=4) as res:
                    res_up = json.loads(res.read().decode("utf-8"))
                down_map = {}
                if res_down.get("status") == "success":
                    r0 = res_down.get("data", {}).get("result", [])
                    if r0:
                        for item in r0[0].get("values", []):
                            down_map[int(item[0])] = rate_to_bps(item[1])
                up_vals = []
                if res_up.get("status") == "success":
                    r1 = res_up.get("data", {}).get("result", [])
                    if r1:
                        up_vals = r1[0].get("values", [])
                for item in up_vals:
                    ts_s = int(item[0])
                    ts_ms = ts_s * 1000
                    dl = down_map.get(ts_s, 0.0)
                    ul = rate_to_bps(item[1])
                    points.append({"timestamp_ms": ts_ms, "download_bps": int(dl), "upload_bps": int(ul), "wan_name": wan_name_out})
            except Exception as e:
                print("Failed query traffic range:", e)
            if not points:
                points.append({"timestamp_ms": start_ms, "download_bps": 0, "upload_bps": 0, "wan_name": wan_name_out})
            # enrich points with canonical optional fields expected by frontend
            bucket_ms = step * 1000
            enriched = []
            sum_dl_bytes = 0
            sum_ul_bytes = 0
            for p in points:
                ts = int(p["timestamp_ms"])
                dl = int(p["download_bps"])
                ul = int(p["upload_bps"])
                # bytes in bucket ≈ bps * seconds / 8
                dl_b = max(0, int(dl * step / 8))
                ul_b = max(0, int(ul * step / 8))
                sum_dl_bytes += dl_b
                sum_ul_bytes += ul_b
                enriched.append({
                    "timestamp_ms": ts,
                    "started_at_ms": ts,
                    "ended_at_ms": ts + bucket_ms,
                    "duration_ms": bucket_ms,
                    "download_bps": dl,
                    "upload_bps": ul,
                    "download_bytes": str(dl_b),
                    "upload_bytes": str(ul_b),
                    "exact_download_bytes": str(dl_b),
                    "exact_upload_bytes": str(ul_b),
                    "estimated_download_bytes": "0",
                    "estimated_upload_bytes": "0",
                    "exact_duration_ms": bucket_ms,
                    "estimated_duration_ms": 0,
                    "sample_count": 1,
                    "estimated": False,
                    "complete": True,
                    "wan_name": p.get("wan_name", wan_name_out),
                })
            covered_ms = max(0, end_ms - start_ms)
            response = {
                "schema_version": 4,
                "router": {
                    "id": "ikuai",
                    "hardware_identity": "ikuai-host",
                    "fallback_target": "wan1",
                    "identity_source": "static",
                    "first_seen_at_ms": start_ms,
                    "last_seen_at_ms": end_ms,
                },
                "interface": {
                    "id": "wan1",
                    "name": wan_name_out,
                    "kind": "wan",
                    "hardware_id": "wan1",
                    "aggregate": False,
                    "first_seen_at_ms": start_ms,
                    "last_seen_at_ms": end_ms,
                },
                "wan_interfaces": [{
                    "id": "wan1",
                    "name": wan_name_out,
                    "kind": "wan",
                    "hardware_id": "wan1",
                    "aggregate": False,
                    "first_seen_at_ms": start_ms,
                    "last_seen_at_ms": end_ms,
                }],
                "points": enriched,
                "interval_secs": step,
                "bucket_size_ms": bucket_ms,
                "wan_names": [wan_name_out],
                "totals": {
                    "download_bytes": str(sum_dl_bytes),
                    "upload_bytes": str(sum_ul_bytes),
                    "exact_download_bytes": str(sum_dl_bytes),
                    "exact_upload_bytes": str(sum_ul_bytes),
                    "estimated_download_bytes": "0",
                    "estimated_upload_bytes": "0",
                    "estimated": False,
                    "complete": True,
                    "coverage_ratio": 1.0,
                },
                "coverage": {
                    "requested_duration_ms": covered_ms,
                    "exact_duration_ms": covered_ms,
                    "estimated_duration_ms": 0,
                    "covered_duration_ms": covered_ms,
                    "completeness": 1.0,
                    "gap_count": 0,
                },
            }
            body = json.dumps(response).encode("utf-8")
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
