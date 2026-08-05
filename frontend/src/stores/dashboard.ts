import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import type {
  SystemInfo,
  GatewayInfo,
  InterfaceSummary,
  IspInfo,
  LatencyProbe,
  TrafficPoint,
  WifiInfo,
  IspStability,
  InterfaceStatus,
  DashboardSnapshot,
  DashboardUpdate,
  WanEntry,
  WanIspInfo,
  IkuaiExtra,
} from '@/types/dashboard';
import type { TimeRange } from '@/types/charts';
import { timeRangeToMs } from '@/types/charts';
import { reconcileDeviceOverrides } from '@/composables/useDeviceOverrides';
import {
  DEFAULT_SYSTEM_INFO,
  DEFAULT_GATEWAY_INFO,
  DEFAULT_INTERFACE_SUMMARY,
  DEFAULT_ISP_INFO,
  DEFAULT_WIFI_INFO,
  DEFAULT_STABILITY,
} from '@/types/dashboard';

/**
 * Central dashboard data store.
 * All dashboard components read from this store reactively.
 */
export const useDashboardStore = defineStore('dashboard', () => {
  // ── State ───────────────────────────────────────────

  const system = ref<SystemInfo>({ ...DEFAULT_SYSTEM_INFO });
  const gateway = ref<GatewayInfo>({ ...DEFAULT_GATEWAY_INFO });
  const interfaces = ref<InterfaceSummary>({ ...DEFAULT_INTERFACE_SUMMARY });
  const isp = ref<IspInfo>({ ...DEFAULT_ISP_INFO });
  const latencyProbes = ref<LatencyProbe[]>([]);
  /// Full 6h rolling buffer – backend sends pruned history, we keep everything.
  const _trafficBuffer = ref<TrafficPoint[]>([]);
  const trafficTimeRange = ref<'5M' | '1H' | '6H' | '24H' | '7D' | '30D'>('1H');
  const wifi = ref<WifiInfo>({ ...DEFAULT_WIFI_INFO });
  const stability = ref<IspStability>({ ...DEFAULT_STABILITY });
  const interfaceStatuses = ref<InterfaceStatus[]>([]);

  const ikuaiConnected = ref(false); // retained for backward compat — reflects router connectivity
  const lastPollTimestamp = ref<string | null>(null);
  const wsConnected = ref(false);
  const freshnessNowMs = ref(Date.now());

  // ── Multi-WAN State ─────────────────────────────────
  const wans = ref<WanEntry[]>([]);
  const wansIsp = ref<WanIspInfo[]>([]);
  const _wanTrafficBuffers = ref<Record<string, TrafficPoint[]>>({});
  const selectedWan = ref<string | null>(null);
  /** gateway 附加详情：DNS / 拨号 / 连接分项 / homepage IP */
  const ikuaiExtra = ref<IkuaiExtra | null>(null);

  // ── Rate Computed (sum of all WANs or single ISP fallback) ──
  const totalDownloadBps = computed(() => {
    if (wans.value.length > 0) {
      return wans.value.reduce((s, w) => s + w.download_bps, 0);
    }
    return isp.value.download_bps;
  });
  const totalUploadBps = computed(() => {
    if (wans.value.length > 0) {
      return wans.value.reduce((s, w) => s + w.upload_bps, 0);
    }
    return isp.value.upload_bps;
  });

  const selectedWanEntry = computed(() => {
    if (!selectedWan.value) return null;
    return wans.value.find((wan) => wan.wan_name === selectedWan.value) ?? null;
  });
  const currentDownloadBps = computed(() =>
    selectedWanEntry.value?.download_bps ?? totalDownloadBps.value,
  );
  const currentUploadBps = computed(() =>
    selectedWanEntry.value?.upload_bps ?? totalUploadBps.value,
  );

  // ── Getters ─────────────────────────────────────────

  const isLive = computed(() => {
    if (!ikuaiConnected.value || !wsConnected.value || !lastPollTimestamp.value) {
      return false;
    }
    const lastPollMs = Date.parse(lastPollTimestamp.value);
    return Number.isFinite(lastPollMs)
      && freshnessNowMs.value - lastPollMs <= 45_000;
  });
  const systemUptimeFormatted = computed(() => system.value.uptime || '—');
  const downloadRate = computed(() => formatRate(currentDownloadBps.value));
  const uploadRate = computed(() => formatRate(currentUploadBps.value));
  const onlineRateFormatted = computed(() => `${stability.value.online_rate.toFixed(1)}%`);
  /// Reactive viewport — sliced from full buffer on every time-range change.
  const trafficPoints = computed(() =>
    pruneByTimestamp(_trafficBuffer.value, trafficTimeRange.value),
  );

  // ── Multi-WAN Getters ───────────────────────────────
  const hasMultipleWans = computed(() => wans.value.length > 1);
  const wanNames = computed(() => wans.value.map((w) => w.wan_name));
  /// Per-WAN traffic points for the selected WAN (reactive viewport).
  const wanTrafficPoints = computed(() => {
    if (!selectedWan.value) return [] as TrafficPoint[];
    const buf = _wanTrafficBuffers.value[selectedWan.value];
    if (!buf) return [] as TrafficPoint[];
    return pruneByTimestamp(buf, trafficTimeRange.value);
  });

  // ── Actions ─────────────────────────────────────────

  function isBlankIp(val: unknown): boolean {
    const s = String(val ?? '').trim();
    return !s || s === '—' || s === '-' || s === 'N/A' || s === 'n/a' || s === 'null' || s === 'None';
  }

  function extraConnTotal(extra: IkuaiExtra | null | undefined): number {
    const c = extra?.connections;
    if (!c) return 0;
    return (Number(c.tcp) || 0) + (Number(c.udp) || 0) + (Number(c.icmp) || 0);
  }

  /** 合并 gateway：空 IP 不覆盖已有好值 */
  function mergeGateway(next: GatewayInfo) {
    const cur = gateway.value;
    const wanIp = !isBlankIp(next.wan_ip) ? next.wan_ip : cur.wan_ip;
    const gwIp = !isBlankIp(next.gateway_ip) ? next.gateway_ip : cur.gateway_ip;
    Object.assign(cur, next, { wan_ip: wanIp, gateway_ip: gwIp });
  }

  /** 合并 isp：用量/连接数 0 不覆盖已有好值；速率照常更新 */
  function mergeIsp(next: IspInfo) {
    const cur = isp.value;
    const monthly = (Number(next.monthly_usage_gb) || 0) > 0
      ? next.monthly_usage_gb
      : cur.monthly_usage_gb;
    const covered = (Number(next.monthly_usage_covered_seconds) || 0) > 0
      ? next.monthly_usage_covered_seconds
      : cur.monthly_usage_covered_seconds;
    let conn = Number(next.connection_count) || 0;
    if (conn <= 0) {
      const fromExtra = extraConnTotal(ikuaiExtra.value);
      conn = fromExtra > 0 ? fromExtra : (Number(cur.connection_count) || 0);
    }
    const td = (Number(next.total_download_bytes) || 0) > 0
      ? next.total_download_bytes
      : cur.total_download_bytes;
    const tu = (Number(next.total_upload_bytes) || 0) > 0
      ? next.total_upload_bytes
      : cur.total_upload_bytes;
    Object.assign(cur, next, {
      monthly_usage_gb: monthly,
      monthly_usage_covered_seconds: covered,
      connection_count: conn,
      total_download_bytes: td,
      total_upload_bytes: tu,
    });
  }

  /** 合并 wifi/终端：空 devices 不覆盖已有列表 */
  function mergeWifi(next: WifiInfo) {
    const cur = wifi.value;
    const devices = (Array.isArray(next.devices) && next.devices.length > 0)
      ? next.devices
      : cur.devices;
    Object.assign(cur, next, { devices });
  }

  function mergeIkuaiExtra(next: IkuaiExtra | null | undefined) {
    if (!next || typeof next !== 'object') return;
    const cur = ikuaiExtra.value || {};
    const merged: IkuaiExtra = { ...cur, ...next };
    // dns 空数组不盖
    if (Array.isArray(next.dns) && next.dns.length === 0 && Array.isArray(cur.dns) && cur.dns.length > 0) {
      merged.dns = cur.dns;
    }
    // connections 全 0 不盖
    const nTotal = extraConnTotal(next);
    const cTotal = extraConnTotal(cur);
    if (nTotal <= 0 && cTotal > 0) {
      merged.connections = cur.connections;
    }
    // homepage ip 空不盖
    if (isBlankIp(next.homepage_wan_ip) && !isBlankIp(cur.homepage_wan_ip)) {
      merged.homepage_wan_ip = cur.homepage_wan_ip;
    }
    ikuaiExtra.value = merged;

    // 用 extra 回填 gateway.wan_ip / isp.connection_count（不改布局，只补数）
    if (isBlankIp(gateway.value.wan_ip) && !isBlankIp(merged.homepage_wan_ip)) {
      gateway.value.wan_ip = String(merged.homepage_wan_ip);
    }
    const ec = extraConnTotal(merged);
    if ((Number(isp.value.connection_count) || 0) <= 0 && ec > 0) {
      isp.value.connection_count = ec;
    }
  }

  function mergeWans(nextWans: WanEntry[]) {
    if (!Array.isArray(nextWans) || nextWans.length === 0) {
      // 空列表不 Cleared 已有 WAN 身份（速率旁路仍可能更新 isp）
      if (wans.value.length > 0) return;
      applyWans(nextWans);
      return;
    }
    const prevByName = new Map(wans.value.map((w) => [w.wan_name, w]));
    const merged = nextWans.map((w) => {
      const prev = prevByName.get(w.wan_name);
      if (!prev) return w;
      return {
        ...w,
        wan_ip: !isBlankIp(w.wan_ip) ? w.wan_ip : prev.wan_ip,
        gateway_ip: !isBlankIp(w.gateway_ip) ? w.gateway_ip : prev.gateway_ip,
      };
    });
    applyWans(merged);
  }


  function handleSnapshot(snapshot: DashboardSnapshot) {
    reconcileDeviceOverrides();
    system.value = snapshot.system;
    // 先吃 ikuai_extra，后面 mergeGateway/Isp 才能用 homepage / 连接分项兜底
    if (snapshot.ikuai_extra) mergeIkuaiExtra(snapshot.ikuai_extra);
    mergeGateway(snapshot.gateway);
    interfaces.value = snapshot.interfaces;
    mergeIsp(snapshot.isp);
    latencyProbes.value = snapshot.latency_probes;
    // live 裁剪跟随当前时间档（不再写死 6H）
    _trafficBuffer.value = pruneByTimestamp(snapshot.traffic.points, trafficTimeRange.value);
    mergeWifi(snapshot.wifi);
    stability.value = snapshot.stability;
    interfaceStatuses.value = snapshot.interface_statuses;

    // Multi-WAN fields（空 wan_ip 不盖）
    mergeWans(snapshot.wans || []);
    wansIsp.value = snapshot.wans_isp || [];

    // Populate per-WAN traffic buffers
    const newBuffers: Record<string, TrafficPoint[]> = {};
    if (snapshot.wan_traffic_points && snapshot.wan_traffic_points.length > 0) {
      for (const pt of snapshot.wan_traffic_points) {
        if (pt.wan_name) {
          if (!newBuffers[pt.wan_name]) {
            newBuffers[pt.wan_name] = [];
          }
          newBuffers[pt.wan_name].push(pt);
          // Prune to 6h
          newBuffers[pt.wan_name] = pruneByTimestamp(newBuffers[pt.wan_name], trafficTimeRange.value);
        }
      }
    }
    _wanTrafficBuffers.value = newBuffers;

    ikuaiConnected.value = true;
    lastPollTimestamp.value = snapshot.timestamp;
    freshnessNowMs.value = Date.now();
  }

  function handleUpdate(update: DashboardUpdate) {
    if (update.system) Object.assign(system.value, update.system);
    if (update.ikuai_extra) mergeIkuaiExtra(update.ikuai_extra);
    if (update.gateway) mergeGateway(update.gateway);
    if (update.interfaces) Object.assign(interfaces.value, update.interfaces);
    if (update.isp) mergeIsp(update.isp);
    if (update.traffic) {
      _trafficBuffer.value.push(update.traffic);
      _trafficBuffer.value = pruneByTimestamp(_trafficBuffer.value, trafficTimeRange.value);
    }
    if (update.latency_probes) latencyProbes.value = update.latency_probes;
    if (update.wifi) {
      reconcileDeviceOverrides();
      mergeWifi(update.wifi);
    }
    if (update.stability) Object.assign(stability.value, update.stability);
    if (update.interface_statuses) interfaceStatuses.value = update.interface_statuses;

    // Multi-WAN updates（空列表 / 空 IP 不 Cleared）
    if (update.wans) mergeWans(update.wans);
    if (update.wans_isp) wansIsp.value = update.wans_isp;
    if (update.wan_traffic_points && update.wan_traffic_points.length > 0) {
      const newBuffers = { ..._wanTrafficBuffers.value };
      for (const pt of update.wan_traffic_points) {
        if (pt.wan_name) {
          if (!newBuffers[pt.wan_name]) {
            newBuffers[pt.wan_name] = [];
          }
          newBuffers[pt.wan_name].push(pt);
          newBuffers[pt.wan_name] = pruneByTimestamp(newBuffers[pt.wan_name], trafficTimeRange.value);
        }
      }
      _wanTrafficBuffers.value = newBuffers;
    }

    lastPollTimestamp.value = update.timestamp;
    ikuaiConnected.value = true;
    freshnessNowMs.value = Date.now();
  }

  function handleConnectionStatus(connected: boolean, lastPoll: string | null) {
    ikuaiConnected.value = connected;
    if (lastPoll) lastPollTimestamp.value = lastPoll;
    freshnessNowMs.value = Date.now();
  }

  function setTrafficTimeRange(range: TimeRange) {
    trafficTimeRange.value = range;
  }

  function selectWan(wanName: string | null) {
    selectedWan.value = wanName && wans.value.some((wan) => wan.wan_name === wanName)
      ? wanName
      : null;
  }

  function refreshFreshness(now = Date.now()) {
    freshnessNowMs.value = now;
  }

  function applyWans(nextWans: WanEntry[]) {
    wans.value = nextWans;
    const validNames = new Set(nextWans.map((wan) => wan.wan_name));
    if (nextWans.length <= 1 || (selectedWan.value && !validNames.has(selectedWan.value))) {
      selectedWan.value = null;
    }

    const nextBuffers: Record<string, TrafficPoint[]> = {};
    for (const [name, points] of Object.entries(_wanTrafficBuffers.value)) {
      if (validNames.has(name)) nextBuffers[name] = points;
    }
    _wanTrafficBuffers.value = nextBuffers;
  }

  /** Filter traffic points by actual timestamp, keeping only those within the window. */
  function pruneByTimestamp(
    points: TrafficPoint[],
    range: TimeRange,
  ): TrafficPoint[] {
    const now = Date.now();
    const cutoff = now - timeRangeToMs(range);
    return points.filter((p) => new Date(p.timestamp).getTime() >= cutoff);
  }

  // ── Return ─────────────────────────────────────────

  return {
    // State
    system,
    ikuaiExtra,
    gateway,
    interfaces,
    isp,
    latencyProbes,
    trafficPoints,
    trafficTimeRange,
    wifi,
    stability,
    interfaceStatuses,
    ikuaiConnected,
    lastPollTimestamp,
    wsConnected,
    totalDownloadBps,
    totalUploadBps,
    currentDownloadBps,
    currentUploadBps,
    // Multi-WAN state
    wans,
    wansIsp,
    selectedWan,
    // Getters
    isLive,
    systemUptimeFormatted,
    downloadRate,
    uploadRate,
    onlineRateFormatted,
    // Multi-WAN getters
    hasMultipleWans,
    wanNames,
    wanTrafficPoints,
    // Actions
    handleSnapshot,
    handleUpdate,
    handleConnectionStatus,
    setTrafficTimeRange,
    selectWan,
    refreshFreshness,
  };
});

function formatRate(bps: number): string {
  if (bps === 0) return '0 bps';
  const mbps = bps / 1_000_000;
  if (mbps >= 1) return `${mbps.toFixed(1)} Mbps`;
  const kbps = bps / 1_000;
  return `${kbps.toFixed(1)} Kbps`;
}
