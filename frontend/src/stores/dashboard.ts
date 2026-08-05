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

  function handleSnapshot(snapshot: DashboardSnapshot) {
    reconcileDeviceOverrides();
    system.value = snapshot.system;
    gateway.value = snapshot.gateway;
    interfaces.value = snapshot.interfaces;
    isp.value = snapshot.isp;
    latencyProbes.value = snapshot.latency_probes;
    // Backend sends up to 6h of history — keep full buffer, viewport derived reactively
    _trafficBuffer.value = pruneByTimestamp(snapshot.traffic.points, '6H');
    wifi.value = snapshot.wifi;
    stability.value = snapshot.stability;
    interfaceStatuses.value = snapshot.interface_statuses;

    // Multi-WAN fields
    applyWans(snapshot.wans || []);
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
          newBuffers[pt.wan_name] = pruneByTimestamp(newBuffers[pt.wan_name], '6H');
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
    if (update.gateway) {
      Object.assign(gateway.value, update.gateway);
    }
    if (update.interfaces) Object.assign(interfaces.value, update.interfaces);
    if (update.isp) {
      Object.assign(isp.value, update.isp);
    }
    if (update.traffic) {
      _trafficBuffer.value.push(update.traffic);
      _trafficBuffer.value = pruneByTimestamp(_trafficBuffer.value, '6H');
    }
    if (update.latency_probes) latencyProbes.value = update.latency_probes;
    if (update.wifi) {
      reconcileDeviceOverrides();
      Object.assign(wifi.value, update.wifi);
    }
    if (update.stability) Object.assign(stability.value, update.stability);
    if (update.interface_statuses) interfaceStatuses.value = update.interface_statuses;

    // Multi-WAN updates
    if (update.wans) applyWans(update.wans);
    if (update.wans_isp) wansIsp.value = update.wans_isp;
    if (update.wan_traffic_points && update.wan_traffic_points.length > 0) {
      const newBuffers = { ..._wanTrafficBuffers.value };
      for (const pt of update.wan_traffic_points) {
        if (pt.wan_name) {
          if (!newBuffers[pt.wan_name]) {
            newBuffers[pt.wan_name] = [];
          }
          newBuffers[pt.wan_name].push(pt);
          newBuffers[pt.wan_name] = pruneByTimestamp(newBuffers[pt.wan_name], '6H');
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
