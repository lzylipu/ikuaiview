<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { Device } from '@/types/dashboard';
import { useDashboardStore } from '@/stores/dashboard';
import FeatherIcon from '@/components/shared/FeatherIcon.vue';
import {
  deviceIcon,
  typeLabel,
  signalColor,
  signalLabel,
  dhcpStatusLabel,
} from '@/composables/useDeviceHelpers';
import { useMacVendor } from '@/composables/useMacVendor';
import { useDeviceOverrides } from '@/composables/useDeviceOverrides';

const { displayName, displayType } = useDeviceOverrides();
const { vendorCached, vendorFor } = useMacVendor();

const props = defineProps<{
  devices: Device[];
  selectedMac: string | null;
}>();

const emit = defineEmits<{
  select: [mac: string];
}>();

const store = useDashboardStore();
const searchQuery = ref('');

// ── Preload vendor lookups when device list changes ──────
watch(
  () => props.devices,
  (devices) => {
    const seen = new Set<string>();
    for (const d of devices) {
      const pf = d.mac.replace(/[^0-9a-fA-F]/g, '').substring(0, 6).toUpperCase();
      if (!seen.has(pf)) {
        seen.add(pf);
        vendorFor(d.mac); // fire-and-forget; batched in composable
      }
    }
  },
  { immediate: true },
);

// Group devices by type, filter by search.
const groupedDevices = computed(() => {
  const q = searchQuery.value.trim().toLowerCase();
  let list = props.devices;
  if (q) {
    list = list.filter(
      (d) =>
        displayName(d).toLowerCase().includes(q) ||
        d.hostname.toLowerCase().includes(q) ||
        d.ip.toLowerCase().includes(q) ||
        d.mac.toLowerCase().includes(q),
    );
  }

  const groups: Record<string, Device[]> = {};
  for (const d of list) {
    const t = displayType(d) || 'desktop';
    if (!groups[t]) groups[t] = [];
    groups[t].push(d);
  }
  // Sort groups by device count descending
  const sortedGroups: [string, Device[]][] = Object.entries(groups).sort(
    ([, a], [, b]) => b.length - a.length,
  );
  return sortedGroups;
});

const totalFiltered = computed(() =>
  groupedDevices.value.reduce((sum, [, devs]) => sum + devs.length, 0),
);

function onClick(device: Device) {
  emit('select', device.mac);
}
</script>

<template>
  <div class="card device-list-panel">
    <!-- Header -->
    <div class="list-header">
      <div class="list-title-row">
        <FeatherIcon name="monitor" :size="16" />
        <span class="list-title">终端设备</span>
        <span class="list-count">({{ totalFiltered }})</span>
      </div>
    </div>

    <!-- Search -->
    <div class="search-box">
      <FeatherIcon name="search" :size="14" />
      <input
        v-model="searchQuery"
        type="text"
        class="search-input"
        aria-label="搜索设备"
        placeholder="搜索设备名、IP 或 MAC..."
      />
    </div>

    <!-- Connection banner -->
    <div v-if="!store.ikuaiConnected" class="connection-banner">
      <FeatherIcon name="alert-triangle" :size="14" />
      <span>iKuai 未连接</span>
    </div>

    <!-- Empty state -->
    <div v-if="totalFiltered === 0" class="empty-state">
      <span v-if="searchQuery">没有匹配的设备</span>
      <span v-else>暂无在线设备</span>
    </div>

    <!-- Device list -->
    <div v-else class="device-list-scroll">
      <div
        v-for="([type, devs]) in groupedDevices"
        :key="type"
        class="device-group"
      >
        <div class="group-label">
          {{ typeLabel(type) }}
          <span class="group-count">{{ devs.length }}</span>
        </div>
        <button
          v-for="device in devs"
          :key="device.mac"
          type="button"
          class="device-row"
          :class="{ selected: device.mac === selectedMac }"
          :aria-pressed="device.mac === selectedMac"
          :aria-label="`查看设备 ${displayName(device)} 的详情`"
          :data-device-mac="device.mac"
          @click="onClick(device)"
        >
          <div class="device-left">
            <FeatherIcon :name="deviceIcon(displayType(device))" :size="18" />
            <div class="device-info">
              <span class="device-hostname">{{ displayName(device) }}</span>
              <span class="device-mac mono">{{ device.mac }}</span>
            </div>
          </div>

          <!-- Inline detail grid: IP | Vendor | Interface -->
          <div class="device-detail-row">
            <div class="detail-col col-ip">
              <span class="detail-label">IP</span>
              <span class="detail-value detail-ip mono">{{ device.ip }}</span>
            </div>
            <div class="detail-col col-vendor">
              <span class="detail-label">供应商</span>
              <span class="detail-value mono">{{ vendorCached(device.mac) || '—' }}</span>
            </div>
            <div class="detail-col col-iface">
              <span class="detail-label">接口</span>
              <span class="detail-value mono">{{ device.interface || '—' }}</span>
            </div>
          </div>

          <div class="device-right">
            <span
              v-if="device.signal != null"
              class="device-signal mono"
              :style="{ color: signalColor(device.signal) }"
            >
              {{ signalLabel(device.signal) }}
            </span>
            <span v-else class="device-wired">有线</span>
            <span
              class="dhcp-pill"
              :class="dhcpStatusLabel(device.dhcp_status).type"
            >
              {{ dhcpStatusLabel(device.dhcp_status).text }}
            </span>
          </div>
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.device-list-panel {
  display: flex;
  flex-direction: column;
  gap: 12px;
  overflow: hidden;
  min-height: 0;
}

.list-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-shrink: 0;
}

.list-title-row {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--color-text-secondary);
}

.list-title {
  font-weight: 600;
  font-size: 0.9rem;
  color: var(--color-text-primary);
}

.list-count {
  font-size: 0.75rem;
  color: var(--color-text-muted);
  font-family: var(--font-mono);
}

.search-box {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 10px;
  background: var(--color-bg-input);
  border: 1px solid var(--color-border-light);
  border-radius: var(--border-radius-sm);
  color: var(--color-text-muted);
  flex-shrink: 0;
}

.search-input {
  flex: 1;
  border: none;
  background: transparent;
  outline: none;
  color: var(--color-text-primary);
  font-size: 0.8rem;
  font-family: var(--font-sans);
}

.search-input::placeholder {
  color: var(--color-text-muted);
}

.connection-banner {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  background: var(--color-danger-subtle);
  border: 1px solid rgba(239, 68, 68, 0.2);
  border-radius: var(--border-radius-sm);
  color: var(--color-danger);
  font-size: 0.75rem;
  font-weight: 500;
  flex-shrink: 0;
}

.empty-state {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--color-text-muted);
  font-size: 0.85rem;
}

.device-list-scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding-right: 4px;
}

.device-group {
  margin-bottom: 6px;
}

.group-label {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 0.62rem;
  font-weight: 600;
  color: var(--color-text-muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  padding: 2px 4px 4px;
  margin-bottom: 2px;
  border-bottom: 1px solid var(--color-border-light);
}

.group-count {
  font-weight: 400;
  font-family: var(--font-mono);
  opacity: 0.6;
}

.device-row {
  appearance: none;
  width: 100%;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 8px;
  border-radius: 0;
  cursor: pointer;
  transition: background var(--transition-fast);
  border: 1px solid transparent;
  border-bottom: 1px solid var(--color-border-light);
  flex-wrap: wrap;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
}

.device-row:hover {
  background: var(--color-bg-hover);
}

.device-row.selected {
  background: var(--color-accent-subtle);
  border-color: var(--color-accent-border);
}

.device-left {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
  flex-shrink: 0;
  width: 220px;
}

.device-info {
  display: flex;
  flex-direction: column;
  min-width: 0;
  overflow: hidden;
}

.device-hostname {
  font-size: 0.8rem;
  font-weight: 500;
  color: var(--color-text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.device-mac {
  font-size: 0.66rem;
  color: var(--color-text-muted);
  letter-spacing: 0.02em;
}

.device-right {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.device-signal {
  font-size: 0.72rem;
  font-weight: 500;
}

.device-wired {
  font-size: 0.65rem;
  color: var(--color-text-muted);
}

.device-detail-row {
  display: grid;
  grid-template-columns: 1fr 2fr 1fr;
  gap: 6px;
  flex: 1 1 180px;
  min-width: 140px;
}

.detail-col {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.col-ip { min-width: 0; }
.col-vendor { min-width: 0; }
.col-iface { min-width: 0; }

.detail-label {
  font-size: 0.58rem;
  font-weight: 600;
  color: var(--color-text-muted);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  font-family: var(--font-sans);
}

.detail-value {
  font-size: 0.68rem;
  color: var(--color-text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.detail-ip {
  color: var(--color-accent);
  font-weight: 500;
}

.dhcp-pill {
  padding: 1px 6px;
  border-radius: 100px;
  font-size: 0.6rem;
  font-weight: 600;
}

.dhcp-pill.static {
  background: var(--color-bg-hover);
  color: var(--color-text-muted);
}

.dhcp-pill.dynamic {
  background: var(--color-success-subtle);
  color: var(--color-success);
}
</style>
