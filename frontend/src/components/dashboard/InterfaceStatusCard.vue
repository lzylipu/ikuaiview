<script setup lang="ts">
import { computed } from 'vue';
import { useDashboardStore } from '@/stores/dashboard';
import { storeToRefs } from 'pinia';
import FeatherIcon from '@/components/shared/FeatherIcon.vue';

const store = useDashboardStore();
const { interfaceStatuses } = storeToRefs(store);

const typeLabel = (t: string): string => {
  switch (t) {
    case 'pppoe-out': return 'PPPoE';
    case 'pppoe-in': return 'PPPoE-IN';
    case 'l2tp-out': return 'L2TP';
    case 'sstp-out': return 'SSTP';
    case 'ether': return '以太网';
    case 'wlan': return 'WiFi';
    case 'wifi': return 'WiFi';
    case 'bridge': return '桥接';
    case 'vlan': return 'VLAN';
    default: return t.toUpperCase();
  }
};

const rateDisplay = (bps: number): string => {
  if (bps === 0) return '0';
  const mbps = bps / 1_000_000;
  if (mbps >= 1) return mbps.toFixed(1) + 'M';
  const kbps = bps / 1_000;
  return kbps.toFixed(0) + 'K';
};

const rxColor = 'var(--color-success)';
const txColor = 'var(--color-accent)';
const runningColor = 'var(--color-success)';
const stoppedColor = 'var(--color-danger)';
</script>

<template>
  <div class="card iface-card">
    <div class="card-title-row">
      <FeatherIcon name="server" :size="16" />
      <span class="card-title">接口状态</span>
      <span class="iface-count">({{ interfaceStatuses.length }})</span>
    </div>

    <div v-if="interfaceStatuses.length === 0" class="no-data">
      暂无接口数据
    </div>

    <div v-else class="iface-list">
      <div
        v-for="iface in interfaceStatuses"
        :key="iface.name"
        class="iface-item"
      >
        <div class="iface-left">
          <span
            class="iface-dot"
            :style="{ backgroundColor: iface.running ? runningColor : stoppedColor }"
          />
          <div class="iface-info">
            <span class="iface-name">
              {{ iface.name }}
              <span v-if="iface.is_wan" class="wan-badge">WAN</span>
            </span>
            <span class="iface-type">{{ typeLabel(iface.type) }}</span>
          </div>
        </div>
        <div class="iface-right">
          <span class="iface-rate rx" :style="{ color: rxColor }">
            <FeatherIcon name="download" :size="10" :stroke-width="2.5" />
            {{ rateDisplay(iface.rx_bps) }}
          </span>
          <span class="iface-rate tx" :style="{ color: txColor }">
            <FeatherIcon name="upload" :size="10" :stroke-width="2.5" />
            {{ rateDisplay(iface.tx_bps) }}
          </span>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.iface-card {
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

.iface-count {
  font-size: 0.75rem;
  color: var(--color-text-muted);
  font-family: var(--font-mono);
}

.no-data {
  text-align: center;
  color: var(--color-text-muted);
  font-size: 0.8rem;
  padding: 16px;
  flex: 1;
}

.iface-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
  overflow-y: auto;
  flex: 1;
  min-height: 0;
}

.iface-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 5px 6px;
  border-radius: 4px;
  transition: background var(--transition-fast);
}

.iface-item:hover {
  background: var(--color-bg-hover);
}

.iface-left {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.iface-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  flex-shrink: 0;
}

.iface-info {
  display: flex;
  flex-direction: column;
}

.iface-name {
  font-size: 0.78rem;
  font-weight: 600;
  color: var(--color-text-primary);
  font-family: var(--font-mono);
  display: flex;
  align-items: center;
  gap: 4px;
}

.wan-badge {
  font-size: 0.5rem;
  font-weight: 700;
  padding: 1px 4px;
  border-radius: 3px;
  background: var(--color-accent);
  color: var(--color-text-inverse);
  font-family: var(--font-sans);
  line-height: 1.4;
}

.iface-type {
  font-size: 0.6rem;
  color: var(--color-text-muted);
}

.iface-right {
  display: flex;
  gap: 10px;
  flex-shrink: 0;
}

.iface-rate {
  display: flex;
  align-items: center;
  gap: 2px;
  font-family: var(--font-mono);
  font-size: 0.7rem;
  font-weight: 500;
}

.iface-rate.rx {
  min-width: 52px;
  justify-content: flex-end;
}

.iface-rate.tx {
  min-width: 52px;
  justify-content: flex-end;
}
</style>
