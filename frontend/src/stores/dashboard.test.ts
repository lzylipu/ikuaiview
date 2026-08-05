import { beforeEach, describe, expect, it } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import type { DashboardUpdate, WanEntry } from '@/types/dashboard';
import { useDashboardStore } from './dashboard';

const wan = (name: string, download: number, upload: number): WanEntry => ({
  wan_name: name,
  wan_ip: '192.0.2.2',
  gateway_ip: '192.0.2.1',
  online: true,
  download_bps: download,
  upload_bps: upload,
  is_primary: name === 'wan-a',
});

const update = (timestamp: string, patch: Partial<DashboardUpdate>): DashboardUpdate => ({
  system: null,
  gateway: null,
  interfaces: null,
  isp: null,
  traffic: null,
  latency_probes: null,
  wifi: null,
  stability: null,
  interface_statuses: null,
  timestamp,
  wans: null,
  wans_isp: null,
  wan_traffic_points: null,
  ...patch,
});

describe('dashboard store', () => {
  beforeEach(() => setActivePinia(createPinia()));

  it('uses the selected WAN rates and clears selections that disappear', () => {
    const store = useDashboardStore();
    const timestamp = new Date().toISOString();
    store.handleUpdate(update(timestamp, {
      wans: [wan('wan-a', 1_000, 100), wan('wan-b', 2_000, 200)],
    }));

    expect(store.currentDownloadBps).toBe(3_000);
    store.selectWan('wan-b');
    expect(store.currentDownloadBps).toBe(2_000);
    expect(store.currentUploadBps).toBe(200);

    store.handleUpdate(update(timestamp, { wans: [wan('wan-a', 1_500, 150)] }));
    expect(store.selectedWan).toBeNull();
    expect(store.currentDownloadBps).toBe(1_500);
  });

  it('only reports live data while both transports and poll freshness are valid', () => {
    const store = useDashboardStore();
    const now = Date.now();
    store.handleConnectionStatus(true, new Date(now).toISOString());
    store.wsConnected = true;
    store.refreshFreshness(now + 45_000);
    expect(store.isLive).toBe(true);

    store.refreshFreshness(now + 45_001);
    expect(store.isLive).toBe(false);

    store.handleConnectionStatus(false, null);
    expect(store.isLive).toBe(false);
  });
});
