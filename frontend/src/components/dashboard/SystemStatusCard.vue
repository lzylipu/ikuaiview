<script setup lang="ts">
import { computed } from 'vue';
import { useDashboardStore } from '@/stores/dashboard';
import { storeToRefs } from 'pinia';
import FeatherIcon from '@/components/shared/FeatherIcon.vue';

const store = useDashboardStore();
const { system, gateway, interfaces, wans, hasMultipleWans } = storeToRefs(store);

const memoryUsagePct = computed(() => {
  if (system.value.total_memory === 0) return 0;
  return ((1 - system.value.free_memory / system.value.total_memory) * 100).toFixed(0);
});

const hddUsagePct = computed(() => {
  if (system.value.total_hdd === 0) return 0;
  return ((1 - system.value.free_hdd / system.value.total_hdd) * 100).toFixed(0);
});

const cpuColor = computed(() => {
  const cpu = system.value.cpu_load;
  if (cpu > 80) return 'var(--color-danger)';
  if (cpu > 50) return 'var(--color-warning)';
  return 'var(--color-success)';
});

const onlineWanCount = computed(() => wans.value.filter((w) => w.online).length);
const totalWanCount = computed(() => wans.value.length || 1);
const wanOnline = computed(() => {
  if (wans.value.length > 0) {
    return wans.value.some((w) => w.online);
  }
  return gateway.value.wan_online;
});

function formatRate(bps: number): string {
  if (bps === 0) return '0';
  const mbps = bps / 1_000_000;
  if (mbps >= 1) return mbps.toFixed(1) + 'M';
  const kbps = bps / 1_000;
  return kbps.toFixed(0) + 'K';
}
</script>

<template>
  <div class="card system-status-card">
    <!-- Header with device model -->
    <div class="card-header">
      <div class="device-icon">
        <FeatherIcon name="hard-drive" :size="28" :stroke-width="1.5" />
      </div>
      <div class="device-info">
        <div class="device-model">{{ system.model || 'iKuai' }}</div>
        <div class="device-version">{{ system.version }}</div>
      </div>
      <div class="cpu-badge" :style="{ color: cpuColor }">
        <span class="cpu-value">{{ system.cpu_load.toFixed(0) }}%</span>
        <span class="cpu-label">CPU</span>
      </div>
    </div>

    <!-- Summary icons row -->
    <div class="summary-row">
      <div class="summary-item" :class="{ online: wanOnline }">
        <FeatherIcon name="globe" :size="16" />
        <span class="summary-label">WAN</span>
        <span class="summary-value">
          <template v-if="hasMultipleWans">{{ onlineWanCount }}/{{ totalWanCount }}</template>
          <template v-else>{{ gateway.wan_online ? '在线' : '离线' }}</template>
        </span>
      </div>
      <div class="summary-item">
        <FeatherIcon name="server" :size="16" />
        <span class="summary-label">以太网</span>
        <span class="summary-value">{{ interfaces.ethernet_count }}</span>
      </div>
      <div class="summary-item">
        <FeatherIcon name="monitor" :size="16" />
        <span class="summary-label">终端</span>
        <span class="summary-value">{{ interfaces.connected_devices }}</span>
      </div>
      <div class="summary-item" :class="{ online: interfaces.wifi_online }">
        <FeatherIcon name="wifi" :size="16" />
        <span class="summary-label">WiFi</span>
        <span class="summary-value">{{ interfaces.wifi_count }}</span>
      </div>
      <div class="summary-item">
        <FeatherIcon name="upload" :size="16" />
        <span class="summary-label">IP 分配</span>
        <span class="summary-value">{{ gateway.ip_allocations }}</span>
      </div>
    </div>

    <!-- Core metrics -->
    <div class="metrics-grid">
      <div class="metric-item">
        <span class="metric-label">运行时长</span>
        <span class="metric-value mono">{{ system.uptime }}</span>
      </div>
      <div class="metric-item">
        <span class="metric-label">版本</span>
        <span class="metric-value mono">iKuai {{ system.version }}</span>
      </div>
    </div>

    <!-- Multi-WAN list: embedded directly (rates + IP + gateway) -->
    <div v-if="hasMultipleWans" class="wan-list">
      <div
        v-for="wan in wans"
        :key="wan.wan_name"
        class="wan-item"
        :class="{ offline: !wan.online }"
      >
        <div class="wan-left">
          <span
            class="wan-dot"
            :style="{ backgroundColor: wan.online ? 'var(--color-success)' : 'var(--color-danger)' }"
          />
          <div class="wan-info">
            <span class="wan-name">
              {{ wan.wan_name }}
              <span v-if="wan.is_primary" class="primary-badge">主</span>
            </span>
            <span class="wan-detail">
              <span class="wan-ip">{{ wan.wan_ip }}</span>
              <span class="wan-gw">→ {{ wan.gateway_ip }}</span>
              <span v-if="wan.wan_ipv6 || wan.gateway_ipv6" class="wan-ip wan-ipv6">{{ wan.wan_ipv6 || '—' }}</span>
              <span v-if="wan.wan_ipv6 || wan.gateway_ipv6" class="wan-gw wan-gwv6">→ {{ wan.gateway_ipv6 || '—' }}</span>
            </span>
          </div>
        </div>
        <div class="wan-right">
          <span class="wan-rate rx">
            <FeatherIcon name="download" :size="10" :stroke-width="2.5" />
            {{ formatRate(wan.download_bps) }}
          </span>
          <span class="wan-rate tx">
            <FeatherIcon name="upload" :size="10" :stroke-width="2.5" />
            {{ formatRate(wan.upload_bps) }}
          </span>
        </div>
      </div>
    </div>

    <!-- Single-WAN metrics (fallback) -->
    <div v-else class="metrics-grid">
      <div class="metric-item">
        <span class="metric-label">WAN IP</span>
        <span class="metric-value mono wan-ip">{{ gateway.wan_ip }}</span>
      </div>
      <div class="metric-item">
        <span class="metric-label">网关</span>
        <span class="metric-value mono">{{ gateway.gateway_ip }}</span>
      </div>
      <div v-if="gateway.wan_ipv6 || gateway.gateway_ipv6" class="metric-item">
        <span class="metric-label">WAN IPv6</span>
        <span class="metric-value mono wan-ip">{{ gateway.wan_ipv6 || '—' }}</span>
      </div>
      <div v-if="gateway.wan_ipv6 || gateway.gateway_ipv6" class="metric-item">
        <span class="metric-label">IPv6 网关</span>
        <span class="metric-value mono">{{ gateway.gateway_ipv6 || '—' }}</span>
      </div>
    </div>

    <!-- Memory / HDD bars -->
    <div class="resource-bars">
      <div class="resource-bar">
        <div class="resource-bar__header">
          <span>内存</span>
          <span class="mono">{{ memoryUsagePct }}%</span>
        </div>
        <div class="resource-bar__track">
          <div
            class="resource-bar__fill"
            :style="{ width: memoryUsagePct + '%', backgroundColor: 'var(--color-accent)' }"
          />
        </div>
      </div>
      <div class="resource-bar">
        <div class="resource-bar__header">
          <span>硬盘</span>
          <span class="mono">{{ hddUsagePct }}%</span>
        </div>
        <div class="resource-bar__track">
          <div
            class="resource-bar__fill"
            :style="{ width: hddUsagePct + '%', backgroundColor: 'var(--color-info)' }"
          />
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.system-status-card {
  display: flex;
  flex-direction: column;
  gap: 16px;
  flex: 0 0 auto;
}

.card-header {
  display: flex;
  align-items: center;
  gap: 12px;
}

.device-icon {
  width: 44px;
  height: 44px;
  aspect-ratio: 1;
  flex-shrink: 0;
  border-radius: var(--border-radius-sm);
  background: var(--color-accent-subtle);
  color: var(--color-accent);
  display: flex;
  align-items: center;
  justify-content: center;
}

.device-model {
  font-weight: 600;
  font-size: 0.95rem;
  color: var(--color-text-primary);
}

.device-version {
  font-size: 0.75rem;
  color: var(--color-text-muted);
  font-family: var(--font-mono);
}

.cpu-badge {
  margin-left: auto;
  display: flex;
  align-items: baseline;
  gap: 2px;
  padding: 4px 8px;
  border-radius: var(--border-radius-sm);
  background: var(--color-bg-input);
  font-family: var(--font-mono);
}

.cpu-value {
  font-size: 1.1rem;
  font-weight: 700;
}

.cpu-label {
  font-size: 0.65rem;
}

.summary-row {
  display: flex;
  gap: 4px;
  padding: 10px;
  background: var(--color-bg-input);
  border-radius: var(--border-radius-sm);
  border: 1px solid var(--color-border-light);
}

.summary-item {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  color: var(--color-text-muted);
  padding: 4px 2px;
  border-radius: 4px;
}

.summary-item.online {
  color: var(--color-success);
}

.summary-label {
  font-size: 0.6rem;
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.03em;
}

.summary-value {
  font-size: 1rem;
  font-weight: 700;
  font-family: var(--font-mono);
  color: var(--color-text-primary);
}

.metrics-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}

.metric-item {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.metric-label {
  font-size: 0.7rem;
  color: var(--color-text-muted);
  text-transform: uppercase;
  letter-spacing: 0.03em;
}

.metric-value {
  font-size: 0.85rem;
  font-weight: 500;
  color: var(--color-text-primary);
}

.wan-ip {
  color: var(--color-accent);
}

/* ── Embedded multi-WAN list ────────────────────────── */

.wan-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 6px;
  background: var(--color-bg-input);
  border-radius: var(--border-radius-sm);
  border: 1px solid var(--color-border-light);
}

.wan-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 5px 6px;
  border-radius: 4px;
  transition: background var(--transition-fast);
}

.wan-item:hover {
  background: var(--color-bg-hover);
}

.wan-item.offline {
  opacity: 0.55;
}

.wan-left {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.wan-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  flex-shrink: 0;
}

.wan-info {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.wan-name {
  font-size: 0.78rem;
  font-weight: 600;
  color: var(--color-text-primary);
  font-family: var(--font-mono);
  display: flex;
  align-items: center;
  gap: 4px;
}

.primary-badge {
  font-size: 0.55rem;
  font-weight: 700;
  padding: 0px 4px;
  border-radius: 3px;
  background: var(--color-accent);
  color: var(--color-text-inverse);
  font-family: var(--font-sans);
  line-height: 1.4;
}

.wan-detail {
  font-size: 0.65rem;
  color: var(--color-text-muted);
  font-family: var(--font-mono);
  display: flex;
  gap: 4px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.wan-gw {
  opacity: 0.7;
}

.wan-ipv6 {
  margin-left: 4px;
  color: var(--color-text-secondary);
  font-size: 0.85em;
}

.wan-gwv6 {
  margin-left: 4px;
  color: var(--color-text-muted);
  font-size: 0.85em;
}

.wan-right {
  display: flex;
  gap: 10px;
  flex-shrink: 0;
}

.wan-rate {
  display: flex;
  align-items: center;
  gap: 2px;
  font-family: var(--font-mono);
  font-size: 0.7rem;
  font-weight: 500;
}

.wan-rate.rx {
  color: var(--color-success);
  min-width: 48px;
  justify-content: flex-end;
}

.wan-rate.tx {
  color: var(--color-accent);
  min-width: 48px;
  justify-content: flex-end;
}

.resource-bars {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.resource-bar__header {
  display: flex;
  justify-content: space-between;
  font-size: 0.7rem;
  margin-bottom: 4px;
  color: var(--color-text-secondary);
}

.resource-bar__track {
  height: 4px;
  background: var(--color-bg-input);
  border-radius: 2px;
  overflow: hidden;
}

.resource-bar__fill {
  height: 100%;
  border-radius: 2px;
  transition: width var(--transition-normal);
}
</style>
