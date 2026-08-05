/**
 * Shared device display utilities.
 * Used by ConnectedDevicesCard, DeviceList, and DeviceDetail.
 */

export function deviceIcon(type: string): string {
  switch (type) {
    case 'phone': return 'smartphone';
    case 'tablet': return 'tablet';
    case 'laptop': return 'monitor';
    case 'desktop': return 'monitor';
    case 'iot': return 'cpu';
    case 'router': return 'wifi';
    case 'switch': return 'server';
    case 'apple': return 'monitor';
    case 'media': return 'tv';
    case 'camera': return 'camera';
    case 'printer': return 'printer';
    default: return 'monitor';
  }
}

export function typeLabel(type: string): string {
  switch (type) {
    case 'phone': return '手机';
    case 'tablet': return '平板';
    case 'laptop': return '笔记本';
    case 'desktop': return '桌面';
    case 'iot': return '物联网';
    case 'router': return '路由器';
    case 'switch': return '交换机';
    case 'apple': return 'Apple';
    case 'media': return '媒体';
    case 'camera': return '摄像头';
    case 'printer': return '打印机';
    default: return '其他';
  }
}

export function signalLabel(dbm: number | null | undefined): string {
  if (dbm == null) return '—';
  return `${dbm} dBm`;
}

export function signalColor(dbm: number | null | undefined): string {
  if (dbm == null) return 'var(--color-text-muted)';
  if (dbm > -50) return 'var(--color-success)';
  if (dbm > -70) return 'var(--color-warning)';
  return 'var(--color-danger)';
}

export function signalQuality(dbm: number | null | undefined): 'excellent' | 'good' | 'poor' | 'wired' {
  if (dbm == null) return 'wired';
  if (dbm > -50) return 'excellent';
  if (dbm > -70) return 'good';
  return 'poor';
}

export function formatDuration(seconds: number): string {
  if (seconds <= 0) return '—';
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days}天${hours}小时`;
  if (hours > 0) return `${hours}小时${mins}分钟`;
  return `${mins}分钟`;
}

/**
 * Parse an iKuai DHCP expires_after string like "00:42:15" into a
 * human-readable remaining time label.
 */
export function formatLeaseExpiry(expires: string | null): { text: string; isExpiringSoon: boolean } {
  if (!expires) return { text: '静态', isExpiringSoon: false };

  const parts = expires.split(':');
  if (parts.length < 2) return { text: expires, isExpiringSoon: false };

  const h = parseInt(parts[0], 10) || 0;
  const m = parseInt(parts[1], 10) || 0;
  const s = parseInt(parts[2], 10) || 0;
  const totalSeconds = h * 3600 + m * 60 + s;

  if (h > 0) return { text: `${h}小时${m}分钟`, isExpiringSoon: totalSeconds < 600 };
  if (m > 0) return { text: `${m}分钟${s}秒`, isExpiringSoon: totalSeconds < 300 };
  return { text: `${s}秒`, isExpiringSoon: totalSeconds < 60 };
}

export function dhcpStatusLabel(status: string | null): { text: string; type: 'static' | 'dynamic' | 'none' } {
  if (!status) return { text: '静态', type: 'static' };
  switch (status) {
    case 'bound': return { text: '已分配', type: 'dynamic' };
    case 'waiting': return { text: '等待中', type: 'dynamic' };
    case 'offered': return { text: '协商中', type: 'dynamic' };
    default: return { text: status, type: 'dynamic' };
  }
}

export function arpStatusLabel(status: string | null): string {
  if (!status) return '—';
  switch (status) {
    case 'reachable': return '可达';
    case 'permanent': return '静态绑定';
    case 'stale': return '待更新';
    case 'delay': return '延迟探测';
    case 'probe': return '探测中';
    default: return status;
  }
}
