<script setup lang="ts">
import { computed } from 'vue';
import { useDashboardStore } from '@/stores/dashboard';
import { storeToRefs } from 'pinia';
import FeatherIcon from '@/components/shared/FeatherIcon.vue';
import {
  deviceIcon,
  typeLabel,
  signalColor,
  signalLabel,
} from '@/composables/useDeviceHelpers';
import { useDeviceOverrides } from '@/composables/useDeviceOverrides';

const { displayName, displayType } = useDeviceOverrides();

const store = useDashboardStore();
const { wifi } = storeToRefs(store);

const devicesByType = computed(() => {
  const groups: Record<string, typeof wifi.value.devices> = {};
  for (const d of wifi.value.devices) {
    const t = displayType(d) || 'desktop';
    if (!groups[t]) groups[t] = [];
    groups[t].push(d);
  }
  return groups;
});

const totalDevices = computed(() => wifi.value.devices.length);
</script>

<template>
  <div class="card devices-card">
    <div class="card-title-row">
      <FeatherIcon name="monitor" :size="16" />
      <span class="card-title">在线终端设备</span>
      <span class="device-count">({{ totalDevices }})</span>
    </div>

    <div v-if="totalDevices === 0" class="no-devices">
      暂无在线设备
    </div>

    <div v-else class="device-list">
      <div
        v-for="(devices, type) in devicesByType"
        :key="type"
        class="device-group"
      >
        <div class="group-label">{{ typeLabel(type) }}</div>
        <div
          v-for="device in devices"
          :key="device.mac"
          class="device-item"
          :title="`${device.hostname}\n${device.ip}\n${device.mac}`"
        >
          <div class="device-left">
            <FeatherIcon :name="deviceIcon(displayType(device))" :size="16" />
            <div class="device-info">
              <span class="device-hostname">{{ displayName(device) }}</span>
              <span class="device-ip mono">{{ device.ip }}</span>
            </div>
          </div>
          <div class="device-right">
            <span
              class="device-signal mono"
              :style="{ color: signalColor(device.signal) }"
            >
              {{ signalLabel(device.signal) }}
            </span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.devices-card {
  display: flex;
  flex-direction: column;
  gap: 10px;
  overflow: hidden;
  min-height: 0;
}

.card-title-row {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--color-text-secondary);
  flex-shrink: 0;
}

.card-title {
  font-weight: 600;
  font-size: 0.85rem;
  color: var(--color-text-primary);
}

.device-count {
  font-size: 0.75rem;
  color: var(--color-text-muted);
  font-family: var(--font-mono);
}

.no-devices {
  text-align: center;
  color: var(--color-text-muted);
  font-size: 0.8rem;
  padding: 16px;
  flex: 1;
}

.device-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  overflow-y: auto;
  flex: 1;
  min-height: 0;
  padding-right: 4px;
}

.device-group {
  display: flex;
  flex-direction: column;
}

.group-label {
  font-size: 0.6rem;
  font-weight: 600;
  color: var(--color-text-muted);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  padding-bottom: 3px;
  margin-bottom: 3px;
  border-bottom: 1px solid var(--color-border-light);
}

.device-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 5px 6px;
  border-radius: 4px;
  transition: background var(--transition-fast);
}

.device-item:hover {
  background: var(--color-bg-hover);
}

.device-left {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.device-info {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.device-hostname {
  font-size: 0.78rem;
  color: var(--color-text-primary);
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 120px;
}

.device-ip {
  font-size: 0.65rem;
  color: var(--color-text-muted);
}

.device-right {
  flex-shrink: 0;
}

.device-signal {
  font-size: 0.68rem;
  font-weight: 500;
}
</style>
