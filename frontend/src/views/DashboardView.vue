<script setup lang="ts">
import { useDashboardStore } from '@/stores/dashboard';
import { useWebSocketStore } from '@/stores/websocket';
import { computed } from 'vue';
import SystemStatusCard from '@/components/dashboard/SystemStatusCard.vue';
import WanPppoeCard from '@/components/dashboard/WanPppoeCard.vue';
import IspProbeCard from '@/components/dashboard/IspProbeCard.vue';
import TrafficChart from '@/components/dashboard/TrafficChart.vue';
import ConnectedDevicesCard from '@/components/dashboard/ConnectedDevicesCard.vue';
import FeatherIcon from '@/components/shared/FeatherIcon.vue';

const dashboardStore = useDashboardStore();
const wsStore = useWebSocketStore();

const connectionLabel = computed(() => {
  if (!dashboardStore.wsConnected) return 'WebSocket 未连接';
  if (!dashboardStore.ikuaiConnected) return 'iKuai 未连接';
  if (!dashboardStore.isLive) return '实时数据已过期';
  return null;
});
</script>

<template>
  <div class="dashboard-grid">

    <!-- Connection Banner -->
    <div v-if="connectionLabel" class="connection-banner">
      <FeatherIcon name="alert-triangle" :size="16" />
      <span>{{ connectionLabel }}</span>
      <span class="banner-status">
        WS: {{ wsStore.connectionState }}
      </span>
    </div>

    <!-- Left Column: System + WAN + ISP -->
    <div class="dashboard-left">
      <section class="card router-wan-card" aria-label="路由器系统与 WAN">
        <SystemStatusCard />
        <div class="router-wan-divider" />
        <WanPppoeCard />
      </section>
      <IspProbeCard />
    </div>

    <!-- Right Column: Traffic + Devices -->
    <section class="dashboard-right">
      <TrafficChart />
      <ConnectedDevicesCard />
    </section>
  </div>
</template>

<style scoped>
.connection-banner {
  grid-column: 1 / -1;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 16px;
  background: var(--color-danger-subtle);
  border: 1px solid rgba(239, 68, 68, 0.2);
  border-radius: var(--border-radius-md);
  color: var(--color-danger);
  font-size: 0.8rem;
  font-weight: 500;
}

.banner-status {
  margin-left: auto;
  font-family: var(--font-mono);
  font-size: 0.7rem;
}

.router-wan-card {
  display: flex;
  flex-direction: column;
  gap: 0;
  padding: 16px;
}

.router-wan-card :deep(.card) {
  background: transparent;
  border: none;
  padding: 0;
  box-shadow: none;
}

.router-wan-divider {
  height: 1px;
  background: var(--color-border-light);
  margin: 14px 0;
}
</style>
