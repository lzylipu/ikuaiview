<script setup lang="ts">
/**
 * WanPppoeCard — iKuaiView WAN PPPoE 卡片占位 (will be filled next step)
 * shows gateway wan_ip / gateway_ip / dns / dial info / total traffic / connections
 */
import { useDashboardStore } from '@/stores/dashboard';
import { storeToRefs } from 'pinia';

const store = useDashboardStore();
const { gateway, isp } = storeToRefs(store);
</script>

<template>
  <div class="card wan-pppoe-card">
    <div style="padding:12px;color:var(--color-text-muted);font-size:.8rem">
      WanPppoeCard placeholder — gateway IP: {{ gateway.wan_ip }} | 累计: {{ isp.monthly_usage_gb }}
    </div>
  </div>
</template>

<style scoped>
.wan-pppoe-card { padding: 0; }
</style>
