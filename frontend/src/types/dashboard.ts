// ═══════════════════════════════════════════════════════════════════
// Dashboard Data Types — mirrors the Rust ServerMessage protocol
// ═══════════════════════════════════════════════════════════════════

export interface SystemInfo {
  model: string;
  version: string;
  uptime: string;
  uptime_seconds: number;
  cpu_load: number;
  free_memory: number;
  total_memory: number;
  total_hdd: number;
  free_hdd: number;
  architecture: string;
  board_name: string;
}

export interface WanEntry {
  wan_name: string;
  wan_ip: string;
  gateway_ip: string;
  online: boolean;
  download_bps: number;
  upload_bps: number;
  is_primary: boolean;
  wan_ipv6?: string;
  gateway_ipv6?: string;
}

export interface WanIspInfo {
  wan_name: string;
  name: string;
  online: boolean;
  download_bps: number;
  upload_bps: number;
}

export interface GatewayInfo {
  wan_interface: string;
  wan_ip: string;
  gateway_ip: string;
  wan_online: boolean;
  ip_allocations: number;
  wans: WanEntry[];
  wan_ipv6?: string;
  gateway_ipv6?: string;
}

export interface InterfaceSummary {
  ethernet_count: number;
  wifi_count: number;
  connected_devices: number;
  wifi_online: boolean;
}

export interface IspInfo {
  name: string;
  online: boolean;
  monthly_usage_gb: number;
  download_bps: number;
  upload_bps: number;
  connection_count: number;
  wans: WanIspInfo[];
  connection_count_ipv6?: number;
}

export interface InterfaceStatus {
  name: string;
  type: string;
  running: boolean;
  rx_bps: number;
  tx_bps: number;
  is_wan?: boolean;
  wan_name?: string;
}

export interface LatencyProbe {
  target: string;
  host: string;
  latency_ms: number | null;
  status: 'good' | 'moderate' | 'poor' | 'down' | 'unknown';
  category: 'isp' | 'dns' | 'cloud' | 'cdn' | 'repo';
}

export interface TrafficPoint {
  timestamp: string;
  download_bps: number;
  upload_bps: number;
  wan_name?: string;
}

export interface TrafficSnapshot {
  points: TrafficPoint[];
}

export interface Device {
  mac: string;
  hostname: string;
  ip: string;
  device_type: string;
  signal: number | null;
  connected_duration: number;
  dhcp_status: string | null;
  dhcp_expires: string | null;
  interface: string | null;
  arp_status: string | null;
  custom_name?: string | null;
  custom_type?: string | null;
}

/** @deprecated Use Device instead */
export type WifiDevice = Device;

export interface WifiInfo {
  interface_count: number;
  client_count: number;
  packet_loss_pct: number;
  retransmit_pct: number;
  devices: Device[];
}

export interface StabilitySegment {
  color: string;
  value: number;
  label: string | null;
}

export interface IspStability {
  online_rate: number;
  segments: StabilitySegment[];
  window_minutes: number;
}

// ── Full Snapshot ────────────────────────────────────────

export interface DashboardSnapshot {
  system: SystemInfo;
  gateway: GatewayInfo;
  interfaces: InterfaceSummary;
  isp: IspInfo;
  traffic: TrafficSnapshot;
  latency_probes: LatencyProbe[];
  wifi: WifiInfo;
  stability: IspStability;
  interface_statuses: InterfaceStatus[];
  timestamp: string;
  wans: WanEntry[];
  wans_isp: WanIspInfo[];
  wan_traffic_points: TrafficPoint[];
}

// ── Differential Update ──────────────────────────────────

export interface DashboardUpdate {
  system: SystemInfo | null;
  gateway: GatewayInfo | null;
  interfaces: InterfaceSummary | null;
  isp: IspInfo | null;
  traffic: TrafficPoint | null;
  latency_probes: LatencyProbe[] | null;
  wifi: WifiInfo | null;
  stability: IspStability | null;
  interface_statuses: InterfaceStatus[] | null;
  timestamp: string;
  wans: WanEntry[] | null;
  wans_isp: WanIspInfo[] | null;
  wan_traffic_points: TrafficPoint[] | null;
}

// ── Connection Status ────────────────────────────────────

export interface ConnectionStatus {
  connected: boolean;
  lastPoll: string | null;
}

// ── Server Message Envelope ──────────────────────────────

export type ServerMessage =
  | { type: 'snapshot'; data: DashboardSnapshot }
  | { type: 'update'; data: DashboardUpdate }
  | { type: 'connection_status'; connected: boolean; lastPoll: string | null };

// ── Default / Placeholder Values ─────────────────────────

export const DEFAULT_SYSTEM_INFO: SystemInfo = {
  model: '—',
  version: '—',
  uptime: '—',
  uptime_seconds: 0,
  cpu_load: 0,
  free_memory: 0,
  total_memory: 0,
  total_hdd: 0,
  free_hdd: 0,
  architecture: '—',
  board_name: '—',
};

export const DEFAULT_GATEWAY_INFO: GatewayInfo = {
  wan_interface: '—',
  wan_ip: '—',
  gateway_ip: '—',
  wan_online: false,
  ip_allocations: 0,
  wans: [],
};

export const DEFAULT_INTERFACE_SUMMARY: InterfaceSummary = {
  ethernet_count: 0,
  wifi_count: 0,
  connected_devices: 0,
  wifi_online: false,
};

export const DEFAULT_ISP_INFO: IspInfo = {
  name: '—',
  online: false,
  monthly_usage_gb: 0,
  download_bps: 0,
  upload_bps: 0,
  connection_count: 0,
  wans: [],
};

export const DEFAULT_WIFI_INFO: WifiInfo = {
  interface_count: 0,
  client_count: 0,
  packet_loss_pct: 0,
  retransmit_pct: 0,
  devices: [],
};

export const DEFAULT_STABILITY: IspStability = {
  online_rate: 100,
  segments: [
    { color: '#22c55e', value: 30, label: '100%' },
    { color: '#f59e0b', value: 0, label: null },
    { color: '#6b7280', value: 0, label: null },
  ],
  window_minutes: 30,
};
